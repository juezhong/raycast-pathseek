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
  for (let i = 0; i < 100; i++) {
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
    await assert.rejects(runFzfFilter(binary, index, pidFile, undefined, 250), /time limit/);
    const pid = await waitForPid(pidFile);
    assertGone(pid);
  });
});
