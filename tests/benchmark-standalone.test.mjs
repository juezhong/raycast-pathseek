import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const prefix = "pathseek-benchmark-";

async function temporaryBenchmarkFiles() {
  return (await readdir(os.tmpdir())).filter((name) => name.startsWith(prefix)).sort();
}

test("standalone benchmark builds, searches and removes only its temporary index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pathseek-standalone-fixture-"));
  try {
    const source = path.join(root, "sources");
    const shortcuts = path.join(root, "Shortcuts");
    await mkdir(source);
    await mkdir(shortcuts);
    await mkdir(path.join(source, "nested"));
    for (let i = 0; i < 100; i++) {
      await writeFile(
        path.join(source, "nested", "sampledriver" + String(i).padStart(3, "0") + ".c"),
        "source",
      );
    }
    await writeFile(path.join(source, "nested", "中文文件.txt"), "source");
    await symlink(source, path.join(shortcuts, "project"));
    await symlink(path.join(root, "not-a-directory"), path.join(shortcuts, "broken"));
    const before = await temporaryBenchmarkFiles();

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/benchmark-standalone.mjs",
        root,
        "--shortcuts",
        shortcuts,
        "--hidden",
        "--runs",
        "3",
      ],
      { cwd: path.resolve("."), timeout: 30_000, maxBuffer: 1024 * 1024 },
    );

    const output = JSON.parse(stdout);
    assert.equal(output.benchmarkVersion, 2);
    assert.equal(output.formatVersion, 3);
    assert.equal(output.nodeRss.sampleIntervalMs, 50);
    assert.ok(output.nodeRss.atStartBytes > 0);
    assert.ok(output.nodeRss.afterBenchmarkBytes > 0);
    assert.ok(output.nodeRss.sampledPeakBytes >= output.nodeRss.atStartBytes);
    assert.ok(output.nodeRss.sampledPeakBytes >= output.nodeRss.afterBenchmarkBytes);
    assert.match(output.nodeRss.scope, /excludes fd\/fzf and Raycast/);
    assert.equal(output.host.platform, process.platform);
    assert.equal(output.host.architecture, process.arch);
    assert.equal(output.scanRoots, 2);
    assert.equal(output.symlinkTargets, 1);
    assert.equal(output.symlinkLinksSkipped, 1);
    assert.equal(output.includeHidden, true);
    assert.equal(output.indexedPaths, output.decodedPaths);
    assert.equal(output.decodeStats.runs, 3);
    assert.equal(output.decodeMs, output.decodeStats.p50Ms);
    assert.ok(output.decodeStats.p95Ms >= output.decodeStats.p50Ms);
    assert.ok(output.indexedPaths >= 200);
    assert.ok(output.uncompressedBytes > 0);
    assert.ok(output.compressedBytes > 0);
    assert.equal(output.queries.length, 3);
    assert.equal(output.measuredRounds, 3);
    assert.equal(output.warmupRounds, 1);
    assert.equal(output.queries[0].kind, "frequent-early-limit");
    assert.equal(output.queries[1].kind, "sampled-existing-filename");
    assert.equal(output.queries[2].kind, "full-scan-no-match");
    assert.equal(output.queries[2].resultCount, 0);
    assert.ok(output.queries.every((query) => query.runs === 3));
    assert.ok(output.queries.every((query) => query.p50Ms > 0));
    assert.ok(output.queries.every((query) => query.p95Ms >= query.p50Ms));
    assert.ok(output.queries.every((query) => query.minMs <= query.p50Ms));
    assert.ok(output.queries[1].resultCount > 0);
    assert.ok(output.buildCpu.userMs >= 0);
    assert.ok(output.decodeCpu.userMs >= 0);
    assert.ok(output.searchCpu.userMs >= 0);
    assert.doesNotMatch(stdout + stderr, /sampledriver|中文文件|\.nul\.tmp/);
    assert.ok(!stdout.includes(root));
    assert.deepEqual(await temporaryBenchmarkFiles(), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid repeat count does not create any benchmark index", async () => {
  const before = await temporaryBenchmarkFiles();
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "scripts/benchmark-standalone.mjs", os.tmpdir(), "--runs", "0"],
      { cwd: path.resolve("."), timeout: 10_000 },
    ),
  );
  assert.deepEqual(await temporaryBenchmarkFiles(), before);
});
