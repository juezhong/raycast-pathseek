import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ACTIVE_INDEX_FILENAME,
  cleanupStaleBuildTemps,
  prepareIndex,
  publishIndex,
  readIndexHeader,
} from "../src/lib/index-files.ts";
import { trackStagedIndex } from "../src/lib/staged-index-lifecycle.ts";

const execFileAsync = promisify(execFile);
const stageName = () => "index-" + randomUUID() + ".nul.tmp";

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pathseek-interrupted-build-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function activeIndex(directory) {
  const raw = path.join(directory, "fixture.paths");
  const stage = path.join(directory, stageName());
  await writeFile(raw, "/preserved/folder/file.c\0");
  await prepareIndex(raw, stage, {
    version: 3,
    createdAt: "2026-11-07T00:00:00Z",
    roots: ["/preserved"],
    count: 1,
  });
  await publishIndex(stage, directory);
  await rm(raw);
  return readFile(path.join(directory, ACTIVE_INDEX_FILENAME));
}

test("aborted publish never replaces an already published index", async () => {
  await fixture(async (directory) => {
    const original = await activeIndex(directory);
    const raw = path.join(directory, "new.paths");
    const stage = path.join(directory, stageName());
    await writeFile(raw, "/new/file.txt\0");
    await prepareIndex(raw, stage, {
      version: 3,
      createdAt: "2026-11-07T00:00:00Z",
      roots: ["/new"],
      count: 1,
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(publishIndex(stage, directory, controller.signal), { name: "AbortError" });
    assert.deepEqual(await readFile(path.join(directory, ACTIVE_INDEX_FILENAME)), original);
    assert.equal((await stat(stage)).isFile(), true);
    // 中止时由 rebuildIndex 的 finally 删除 stage，本测试单独验证提交边界。
  });
});

test("writer lock recovery immediately reclaims all orphan stages without touching index/config", async () => {
  await fixture(async (directory) => {
    const original = await activeIndex(directory);
    const configSentinel = path.join(directory, "my-settings.json");
    const unrelated = path.join(directory, "user-notes.tmp");
    const oldDevelopment = path.join(directory, "index-development-v3");
    await mkdir(oldDevelopment);
    await writeFile(path.join(oldDevelopment, "index.nul"), "old index");
    await writeFile(configSentinel, '{"roots":["/preserved"]}');
    await writeFile(unrelated, "keep");
    await writeFile(path.join(directory, "index-not-a-valid-id.nul.tmp"), "keep");
    const interrupted = [stageName(), stageName()];
    for (const filename of interrupted) {
      await writeFile(path.join(directory, filename), Buffer.alloc(65536));
    }
    await writeFile(path.join(directory, "build-progress.json.tmp"), "partial progress");

    // rebuildIndex 只能在获取独占锁后使用 graceMs=0。
    assert.equal(await cleanupStaleBuildTemps(directory, Date.now(), 0), 3);
    assert.deepEqual(await readFile(path.join(directory, ACTIVE_INDEX_FILENAME)), original);
    assert.equal((await readIndexHeader(path.join(directory, ACTIVE_INDEX_FILENAME))).count, 1);
    assert.equal(await readFile(configSentinel, "utf8"), '{"roots":["/preserved"]}');
    assert.equal(await readFile(unrelated, "utf8"), "keep");
    assert.equal(await readFile(path.join(oldDevelopment, "index.nul"), "utf8"), "old index");
    assert.equal((await readdir(directory)).some((name) => interrupted.includes(name)), false);
    assert.equal(await cleanupStaleBuildTemps(directory, Date.now(), 0), 0);
  });
});

test("grace period still protects recent files outside explicit lock-recovery mode", async () => {
  await fixture(async (directory) => {
    const filename = stageName();
    await writeFile(path.join(directory, filename), "active or recently written");
    assert.equal(await cleanupStaleBuildTemps(directory), 0);
    assert.equal(await readFile(path.join(directory, filename), "utf8"), "active or recently written");
  });
});

test("normal process exit best-effort removes registered unfinished stage", async () => {
  await fixture(async (directory) => {
    const staged = path.join(directory, stageName());
    await writeFile(staged, "interrupted compressed index");
    const moduleUrl = new URL("../src/lib/staged-index-lifecycle.ts", import.meta.url).href;
    await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import { trackStagedIndex } from ${JSON.stringify(moduleUrl)}; trackStagedIndex(process.argv[1]); process.exit(0);`,
        staged,
      ],
      { timeout: 10_000 },
    );
    await assert.rejects(stat(staged), { code: "ENOENT" });
  });
});

test("staging tracking rejects invalid filenames and never touches a published index", async () => {
  await fixture(async (directory) => {
    const saved = path.join(directory, ACTIVE_INDEX_FILENAME);
    await writeFile(saved, "active");
    assert.throws(() => trackStagedIndex(saved), /Invalid PathSeek staged index path/);
    assert.throws(() => trackStagedIndex("../index-" + randomUUID() + ".nul.tmp"), /Invalid PathSeek staged index path/);
    assert.equal(await readFile(saved, "utf8"), "active");
  });
});
