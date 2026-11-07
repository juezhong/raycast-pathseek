import assert from "node:assert/strict";
import { mkdtemp, chmod, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runFzfFilter } from "../src/lib/fzf-runner.ts";
import { prepareIndex, publishIndex } from "../src/lib/index-files.ts";

async function fixture(action) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-child-lifecycle-"));
  try {
    const raw = path.join(dir, "raw");
    const staged = path.join(dir, "staged.tmp");
    await writeFile(raw, "/example/driver.c\0/example/中文.txt\0");
    await prepareIndex(raw, staged, {
      version: 3,
      count: 2,
      createdAt: new Date().toISOString(),
      roots: ["/example"],
    });
    await publishIndex(staged, dir);
    await action(dir, path.join(dir, "index.nul"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function waitForPid(file) {
  for (let i = 0; i < 300; i++) {
    try { return Number(await readFile(file, "utf8")); }
    catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  throw new Error("Fake fzf child failed to start");
}

function assertGone(pid) {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

test("real fzf searches compressed index with no-match status", async () => {
  await fixture(async (_, index) => {
    const matched = await runFzfFilter("fzf", index, "driver");
    assert.deepEqual(matched.paths, ["/example/driver.c"]);
    assert.equal(matched.cancelled, false);
    const missing = await runFzfFilter("fzf", index, "missing-pattern-987654");
    assert.deepEqual(missing.paths, []);
    assert.equal(missing.exitCode, 1);
  });
});

test("aborting an in-flight fzf kills child, reaps it, and returns no stale paths", async () => {
  await fixture(async (dir, index) => {
    const binary = path.join(dir, "fake-fzf");
    const pidFile = path.join(dir, "child.pid");
    await writeFile(binary,
      "#!/usr/bin/env node\n" +
      "const fs = require('node:fs');\n" +
      "fs.writeFileSync(process.argv.at(-1), String(process.pid));\n" +
      "process.stdin.resume(); setInterval(() => {}, 1000);\n");
    await chmod(binary, 0o755);
    const controller = new AbortController();
    const task = runFzfFilter(binary, index, pidFile, controller.signal, 10000);
    const pid = await waitForPid(pidFile);
    controller.abort();
    const result = await task;
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.paths, []);
    assertGone(pid);
  });
});

test("timeout escalates to SIGKILL when fzf ignores SIGTERM", async () => {
  await fixture(async (dir, index) => {
    const binary = path.join(dir, "stubborn-fzf");
    const pidFile = path.join(dir, "stubborn.pid");
    await writeFile(binary,
      "#!/usr/bin/env node\n" +
      "const fs = require('node:fs');\n" +
      "fs.writeFileSync(process.argv.at(-1), String(process.pid));\n" +
      "process.on('SIGTERM', () => {});\n" +
      "process.stdin.resume(); setInterval(() => {}, 1000);\n");
    await chmod(binary, 0o755);
    // CI 或繁忙的 macOS 上 Node shebang 冷启动可能超过 250ms。
    // 等待真实超时/升级 SIGKILL，但不要用过短超时误判尚未启动。
    await assert.rejects(runFzfFilter(binary, index, pidFile, undefined, 3000), /time limit/);
    const pid = await waitForPid(pidFile);
    assertGone(pid);
  });
});

test("malformed fzf stdout is bounded and the child is reaped", async () => {
  await fixture(async (dir, index) => {
    const binary = path.join(dir, "malformed-fzf");
    const pidFile = path.join(dir, "malformed.pid");
    await writeFile(
      binary,
      "#!/usr/bin/env node\n" +
        "const fs = require('node:fs');\n" +
        "fs.writeFileSync(process.argv.at(-1), String(process.pid));\n" +
        "process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 65));\n" +
        "process.stdin.resume(); setInterval(() => {}, 1000);\n",
    );
    await chmod(binary, 0o755);
    const rejection = assert.rejects(
      runFzfFilter(binary, index, pidFile, undefined, 10_000),
      /fzf output path exceeds size limit/,
    );
    const pid = await waitForPid(pidFile);
    await rejection;
    assertGone(pid);
  });
});

test("real fzf accepts Chinese pinyin initials, unordered terms, and native extended operators", async () => {
  await fixture(async (dir) => {
    const entries = [
      "/example/第一次.txt",
      "/example/第一次/记录.md",
      "/example/driver.c",
      "/example/abc" + String.fromCharCode(9) + "def.txt",
      "/example/普通中文.txt",
    ];
    const raw = path.join(dir, "pinyin-input.paths");
    const staged = path.join(dir, "pinyin-stage.nul.tmp");
    await writeFile(raw, entries.join(String.fromCharCode(0)) + String.fromCharCode(0));
    await prepareIndex(raw, staged, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/example"],
    });
    await publishIndex(staged, dir);
    const index = path.join(dir, "index.nul");
    for (const query of ["dyc", "yc d", "d y c", "y c d", "diyici", "DYC"]) {
      const matched = await runFzfFilter("fzf", index, query);
      assert.ok(matched.paths.includes("/example/第一次.txt"), query);
      assert.ok(matched.paths.every((value) => entries.includes(value)), query);
    }
    const exactChinese = await runFzfFilter("fzf", index, "'第一次");
    assert.ok(exactChinese.paths.includes("/example/第一次.txt"));
    const extended = await runFzfFilter("fzf", index, ".md$");
    assert.deepEqual(extended.paths, ["/example/第一次/记录.md"]);
    const noPinyinSyntaxOverride = await runFzfFilter("fzf", index, "'dyc");
    assert.equal(noPinyinSyntaxOverride.paths.includes("/example/第一次.txt"), false);
    const tabName = await runFzfFilter("fzf", index, "abc");
    assert.ok(tabName.paths.includes(entries[3]));
  });
});
