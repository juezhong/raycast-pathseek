import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
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
    // 普通扫描和显式快捷目标扫描都不能递归跟随这个循环链接。
    await symlink(root, path.join(source, "loop"));
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
        "--compare",
      ],
      { cwd: path.resolve("."), timeout: 30_000, maxBuffer: 1024 * 1024 },
    );

    const output = JSON.parse(stdout);
    assert.equal(output.benchmarkVersion, 3);
    assert.equal(output.formatVersion, 3);
    assert.equal(output.nodeRss.sampleIntervalMs, 50);
    assert.equal(output.processTreeRss.sampleIntervalMs, 250);
    assert.ok(output.processTreeRss.sampled >= 1);
    assert.ok(output.processTreeRss.peakCombinedRssBytes > 0);
    assert.ok(output.processTreeRss.peakFdRssBytes >= 0);
    assert.ok(output.processTreeRss.peakFzfRssBytes >= 0);
    assert.match(output.processTreeRss.scope, /short bursts can be missed/);
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
    assert.equal(output.compareRequested, true);
    assert.equal(output.comparison.available, true);
    assert.deepEqual(output.comparison.modes, [
      "basename-only",
      "consecutive-parent-path",
      "pinyin-parent-path",
    ]);
    assert.equal(output.indexedPaths, output.decodedPaths);
    assert.equal(output.decodeStats.runs, 3);
    assert.equal(output.decodeMs, output.decodeStats.p50Ms);
    assert.ok(output.decodeStats.p95Ms >= output.decodeStats.p50Ms);
    assert.ok(output.indexedPaths >= 200);
    assert.ok(output.indexedPaths < 500, "Nested symlink traversal would expand the index unexpectedly");
    assert.ok(output.uncompressedBytes > 0);
    assert.ok(output.compressedBytes > 0);
    assert.equal(output.queries.length, 6);
    assert.equal(output.queries[5].kind, "compare-pinyin-parent-path");
    assert.equal(output.queries[3].kind, "compare-leaf-fuzzy");
    assert.equal(output.queries[4].kind, "compare-direct-parent-fuzzy");
    assert.ok(output.queries[3].resultCount > 0);
    assert.ok(output.queries[4].resultCount > 0);
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
    const noMatch = output.queries[2].pipeline;
    assert.equal(noMatch.recordsDecoded, output.indexedPaths);
    assert.ok(noMatch.recordsSentToFzf > 0);
    assert.ok(noMatch.bytesSentToFzf > 0);
    assert.ok(noMatch.batchesSentToFzf > 0);
    assert.ok(
      noMatch.batchesSentToFzf < noMatch.recordsSentToFzf / 10,
      "codec and fzf input must batch paths instead of emitting each record",
    );
    assert.ok(noMatch.transformSyncWallMs >= 0);
    assert.ok(noMatch.decoderEndMs > 0);
    assert.ok(noMatch.stdinFinishMs > 0);
    assert.ok(noMatch.childCloseMs > 0);
    assert.match(noMatch.scope, /Warmup run only/);
    assert.ok(
      output.queries[4].pipeline.recordsSentToFzf <
        noMatch.recordsSentToFzf,
      "directory filtering must reduce records passed to fzf",
    );
    assert.ok(output.buildCpu.userMs >= 0);
    assert.ok(output.decodeCpu.userMs >= 0);
    assert.ok(output.searchCpu.userMs >= 0);
    assert.doesNotMatch(stdout, /sampledriver|中文文件|\.nul\.tmp|pathseek-benchmark-/);
    assert.ok(!stdout.includes(root));
    assert.doesNotMatch(stderr, /sampledriver|中文文件/);

    // 操作日志要给出同一个绝对路径，明确中间文件和最终删除状态。
    const created = stderr.match(/^\[PathSeek benchmark\] Temporary directory: (.+)$/m);
    assert.ok(created, "missing temporary directory log");
    const temporary = created[1];
    assert.ok(path.isAbsolute(temporary));
    assert.match(stderr, new RegExp("Temporary files: .*stage\\.nul\\.tmp -> .*index\\.nul"));
    assert.ok(stderr.includes("[PathSeek benchmark] Created temporary staging file: " + path.join(temporary, "stage.nul.tmp")));
    assert.ok(stderr.includes("[PathSeek benchmark] Published temporary index: " + path.join(temporary, "index.nul")));
    assert.ok(stderr.includes("[PathSeek benchmark] Removed temporary directory (verified): " + temporary));
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


test("failed fd scan still reports the exact temporary directory and verified cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pathseek-benchmark-failure-fixture-"));
  try {
    const bin = path.join(root, "bin");
    await mkdir(bin);
    const fd = path.join(bin, "fd");
    await writeFile(fd, "#!/bin/sh\nexit 19\n");
    await chmod(fd, 0o755);
    const before = await temporaryBenchmarkFiles();
    const error = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/benchmark-standalone.mjs",
        root,
        "--runs",
        "1",
      ],
      { cwd: path.resolve("."), timeout: 30_000, maxBuffer: 1024 * 1024,
        env: { ...process.env, PATH: bin + path.delimiter + (process.env.PATH ?? "") } },
    ).then(() => null, (failure) => failure);
    assert.ok(error);
    assert.match(error.stderr, /Benchmark failed/);
    const created = error.stderr.match(/^\[PathSeek benchmark\] Temporary directory: (.+)$/m);
    assert.ok(created);
    const temporary = created[1];
    assert.ok(error.stderr.includes("[PathSeek benchmark] Cleaning temporary directory: " + temporary));
    assert.ok(error.stderr.includes("[PathSeek benchmark] Removed temporary directory (verified): " + temporary));
    assert.deepEqual(await temporaryBenchmarkFiles(), before);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
