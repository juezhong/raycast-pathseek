import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  beginIndexBuildProgress,
  isProgressStale,
  readIndexBuildProgress,
} from "../src/lib/index-progress.ts";

test("progress persists counters and records final state without paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-progress-test-"));
  try {
    const reporter = await beginIndexBuildProgress(dir, {
      buildId: "test",
      rootCount: 2,
      compressionQuality: 7,
      selectiveSymlinkTargets: 2,
      selectiveSymlinkSkipped: 1,
      includeHidden: true,
    });
    reporter.root(1);
    reporter.fdStarted(1234);
    reporter.input(2048, 19);
    reporter.output(321);
    reporter.fdFinished(0);
    reporter.finalizing();
    await reporter.flush();
    const current = await readIndexBuildProgress(dir);
    assert.equal(current.phase, "finalizing");
    assert.equal(current.pathCount, 19);
    assert.equal(current.inputBytes, 2048);
    assert.equal(current.compressedBytes, 321);
    assert.equal(current.fdExitCode, 0);
    assert.equal(current.compressionQuality, 7);
    assert.equal(current.selectiveSymlinkTargets, 2);
    assert.equal(current.selectiveSymlinkSkipped, 1);
    assert.equal(isProgressStale(current), false);

    await reporter.finish("published");
    assert.equal((await readIndexBuildProgress(dir)).phase, "published");
    const raw = await readFile(path.join(dir, "build-progress.json"), "utf8");
    assert.doesNotMatch(raw, /Users\/alice|secret-file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed progress records only sanitized error codes and stale warning", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-progress-error-"));
  try {
    const reporter = await beginIndexBuildProgress(dir, {
      buildId: "failed",
      rootCount: 1,
      compressionQuality: 11,
      selectiveSymlinkTargets: 1,
      selectiveSymlinkSkipped: 0,
      includeHidden: false,
    });
    await reporter.finish("failed", Object.assign(new Error("/Users/alice/private.txt"), { code: "EIO" }));
    const current = await readIndexBuildProgress(dir);
    assert.equal(current.errorCode, "EIO");
    assert.equal(current.phase, "failed");
    assert.doesNotMatch(JSON.stringify(current), /private.txt/);
    assert.equal(isProgressStale({ ...current, phase: "scanning" }, Date.parse(current.updatedAt) + 16000), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancelled progress retains only a diagnostic state, never becomes a successful index", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-progress-cancel-"));
  try {
    const reporter = await beginIndexBuildProgress(dir, {
      buildId: "cancel-test",
      rootCount: 1,
      compressionQuality: 7,
      selectiveSymlinkTargets: 0,
      selectiveSymlinkSkipped: 0,
      includeHidden: false,
    });
    reporter.input(2048, 4);
    await reporter.finish("cancelled", Object.assign(new Error("Cancelled"), { code: "ABORT_ERR" }));
    const saved = await readIndexBuildProgress(dir);
    assert.equal(saved.phase, "cancelled");
    assert.equal(saved.pathCount, 4);
    assert.equal(saved.errorCode, "ABORT_ERR");
    assert.equal(isProgressStale(saved), false);
    assert.doesNotMatch(JSON.stringify(saved), /private[\\/]user/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
