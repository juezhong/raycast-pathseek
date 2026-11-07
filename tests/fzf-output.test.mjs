import assert from "node:assert/strict";
import test from "node:test";
import {
  appendFzfOutputChunk,
  createFzfOutputState,
  MAX_FZF_PATH_BYTES,
  MAX_FZF_RESULTS,
  MAX_FZF_TOTAL_BYTES,
} from "../src/lib/fzf-output.ts";

test("fzf output is strictly capped when a single stdout chunk has too many entries", () => {
  const state = createFzfOutputState();
  const oversized = Buffer.from(
    Array.from({ length: 159 }, (_, i) => "/test/file-" + i + "\0").join(""),
  );
  appendFzfOutputChunk(state, oversized);
  assert.equal(state.limitReached, true);
  assert.equal(state.results.length, MAX_FZF_RESULTS);
  assert.equal(state.results[0], "/test/file-0");
  assert.equal(state.results.at(-1), "/test/file-149");

  // Queued data events after SIGTERM must never add more results.
  appendFzfOutputChunk(state, Buffer.from("/test/extra\0"));
  assert.equal(state.results.length, MAX_FZF_RESULTS);
});

test("fzf output preserves UTF-8 names across chunk boundaries", () => {
  const state = createFzfOutputState();
  const source = Buffer.from("/test/中文文件.txt\0/test/with newline\nfile.pdf\0", "utf8");
  const first = source.indexOf(Buffer.from("中文")) + 1;
  appendFzfOutputChunk(state, source.subarray(0, first));
  appendFzfOutputChunk(state, source.subarray(first, first + 3));
  appendFzfOutputChunk(state, source.subarray(first + 3));
  assert.deepEqual(state.results, ["/test/中文文件.txt", "/test/with newline\nfile.pdf"]);
  assert.equal(state.limitReached, false);
  assert.equal(state.pending.length, 0);
});

test("fzf output caps across multiple 100-result stdout chunks", () => {
  const state = createFzfOutputState();
  const lines = Array.from({ length: 180 }, (_, i) => "item-" + i + "\0");
  appendFzfOutputChunk(state, Buffer.from(lines.slice(0, 100).join("")));
  assert.equal(state.results.length, 100);
  appendFzfOutputChunk(state, Buffer.from(lines.slice(100).join("")));
  assert.equal(state.results.length, MAX_FZF_RESULTS);
  assert.equal(state.limitReached, true);
});

test("empty records do not appear as results", () => {
  const state = createFzfOutputState();
  appendFzfOutputChunk(state, Buffer.from("\0foo\0\0bar\0"));
  assert.deepEqual(state.results, ["foo", "bar"]);
});

test("fzf output limits an unterminated record across many chunks", () => {
  const state = createFzfOutputState();
  const part = Buffer.alloc(64 * 1024, 65);
  for (let i = 0; i < MAX_FZF_PATH_BYTES / part.length; i++) {
    appendFzfOutputChunk(state, part);
  }
  assert.equal(state.pending.length, MAX_FZF_PATH_BYTES);
  assert.throws(() => appendFzfOutputChunk(state, Buffer.from("X")), /size limit/);
});

test("fzf output rejects oversized NUL-delimited records without retaining them", () => {
  const state = createFzfOutputState();
  const path = Buffer.alloc(MAX_FZF_PATH_BYTES + 2, 65);
  path[path.length - 1] = 0;
  assert.throws(() => appendFzfOutputChunk(state, path), /size limit/);
  assert.equal(state.results.length, 0);
});

test("fzf output accepts a path exactly at the supported size boundary", () => {
  const state = createFzfOutputState();
  const record = Buffer.alloc(MAX_FZF_PATH_BYTES + 1, 65);
  record[record.length - 1] = 0;
  appendFzfOutputChunk(state, record);
  assert.equal(state.results.length, 1);
  assert.equal(Buffer.byteLength(state.results[0]), MAX_FZF_PATH_BYTES);
  assert.equal(state.pending.length, 0);
});

test("fzf results reject excessive aggregate path bytes", () => {
  const state = createFzfOutputState();
  const record = Buffer.alloc(MAX_FZF_PATH_BYTES + 1, 65);
  record[record.length - 1] = 0;
  for (let i = 0; i < MAX_FZF_TOTAL_BYTES / MAX_FZF_PATH_BYTES; i++) {
    appendFzfOutputChunk(state, record);
  }
  assert.equal(state.resultBytes, MAX_FZF_TOTAL_BYTES);
  assert.throws(() => appendFzfOutputChunk(state, record), /memory size limit/);
  assert.equal(state.results.length, 8);
});
