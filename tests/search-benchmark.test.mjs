import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  ACTIVE_INDEX_FILENAME,
  prepareIndex,
  publishIndex,
} from "../src/lib/index-files.ts";

const execFileAsync = promisify(execFile);

test("real fzf can search compressed v3 indexes; CLI reports metrics without paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pathseek-search-benchmark-"));
  try {
    const raw = path.join(directory, "input.paths");
    const staged = path.join(directory, "stage.nul.tmp");
    const source = path.join(directory, ACTIVE_INDEX_FILENAME);
    const files = [
      ...Array.from({ length: 180 }, (_, i) => "/Users/private/Shortcuts/kernel/drivers/driver" + i + ".c"),
      "/Users/private/Shortcuts/kernel/中文文件.txt",
      "/Users/private/Documents/hello.md",
    ];
    await writeFile(raw, Buffer.from(files.join("\0") + "\0"));
    await prepareIndex(raw, staged, {
      version: 3,
      createdAt: "2026-11-07T00:00:00.000Z",
      count: files.length,
      roots: ["/Users/private"],
    });
    await publishIndex(staged, directory);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/benchmark-search.mjs",
        source,
        "kernel",
        "中文文件",
        "NO_MATCH_123456789",
      ],
      { cwd: path.resolve("."), timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    const stats = JSON.parse(stdout);
    assert.equal(stats.indexVersion, 3);
    assert.equal(stats.indexedPaths, files.length);
    assert.equal(stats.measurements.length, 3);
    assert.equal(stats.measurements[0].resultCount, 150);
    assert.equal(stats.measurements[0].limitReached, true);
    assert.equal(stats.measurements[1].resultCount, 1);
    assert.equal(stats.measurements[2].resultCount, 0);
    assert.ok(stats.measurements.every((item) => item.elapsedMs > 0));
    assert.doesNotMatch(stdout, /Users\/private|中文文件|NO_MATCH_123456789/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
