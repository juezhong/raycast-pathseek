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


test("real index path benchmark is read-only and reports reliable baseline metrics without filenames", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pathseek-path-benchmark-"));
  try {
    const raw = path.join(directory, "raw.paths");
    const stage = path.join(directory, "stage.nul.tmp");
    const index = path.join(directory, ACTIVE_INDEX_FILENAME);
    const paths = [
      "/home/private/src/driver.c",
      "/home/private/src/driver.h",
      "/home/private/第一次/第二次.txt",
      "/home/private/other/report.md",
    ];
    await writeFile(raw, paths.join("\0") + "\0");
    await prepareIndex(raw, stage, {
      version: 3,
      count: paths.length,
      createdAt: "2026-11-07T00:00:00.000Z",
      roots: ["/home/private"],
    });
    await publishIndex(stage, directory);
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/benchmark-path-search.mjs",
        index,
        "driver",
        "src/driver",
        "dyc/dec",
        "--runs",
        "2",
      ],
      { cwd: path.resolve("."), timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.indexedPaths, paths.length);
    assert.equal(parsed.rounds, 2);
    assert.equal(parsed.queries.length, 3);
    assert.deepEqual(parsed.queries.map((item) => item.mode), ["basename", "path", "path"]);
    assert.deepEqual(parsed.queries.map((item) => item.results), [2, 2, 1]);
    assert.ok(parsed.queries.every((item) => item.p50Ms > 0 && item.p95Ms >= item.p50Ms));
    assert.ok(parsed.queries.every((item) => item.averageNodeUserCpuMs >= 0));
    assert.ok(parsed.peakNodeRssBytes > 0);
    assert.doesNotMatch(stdout, /home\/private|第二次|dyc\/dec|src\/driver/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cold benchmark starts with no index and builds an isolated fd fixture", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "scripts/benchmark-cold-search.mjs", "32"],
    { cwd: path.resolve("."), timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.benchmark, "fresh-fd-index-and-first-fzf-search");
  assert.equal(parsed.fixtureFiles, 33);
  assert.ok(parsed.indexedPaths >= 33);
  assert.ok(parsed.buildMs > 0);
  assert.ok(parsed.buildNodeCpuMs >= 0);
  assert.deepEqual(
    parsed.firstSearches.map((item) => item.resultCount),
    [32, 32, 1],
  );
  assert.ok(parsed.firstSearches.every((item) => item.elapsedMs > 0));
  assert.ok(parsed.firstSearches.every((item) => item.nodeRssBytes > 0));
  assert.doesNotMatch(stdout, /pathseek-cold-\/|four-file-0|\/第一次\/第二次/);
});
