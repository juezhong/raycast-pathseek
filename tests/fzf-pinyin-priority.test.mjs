import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPinyinPriorityChunk,
  createPinyinPriorityOutput,
  finishPinyinPriorityOutput,
  MAX_PINYIN_OUTPUT_SCAN,
  PINYIN_RESERVED_RESULTS,
} from "../src/lib/fzf-pinyin-priority.ts";
import { MAX_FZF_RESULTS, MAX_FZF_PATH_BYTES } from "../src/lib/fzf-output.ts";

function entry(file) {
  return file + "\t" + "/test/" + file;
}

test("retains Chinese pinyin match after 300 stronger ASCII prefix matches", () => {
  const state = createPinyinPriorityOutput();
  const files = [
    ...Array.from({ length: 300 }, (_, n) => entry("dec" + n + ".c")),
    entry("第二次.txt"),
  ];
  const bytes = Buffer.from(files.join("\0") + "\0");
  for (let at = 0; at < bytes.length; at += 27)
    appendPinyinPriorityChunk(state, bytes.subarray(at, at + 27));
  const results = finishPinyinPriorityOutput(state);
  assert.equal(results.length, MAX_FZF_RESULTS);
  assert.ok(results.includes(entry("第二次.txt")));
  assert.equal(new Set(results).size, results.length);
  assert.equal(state.scanned, files.length);
});

test("falls back to top 150 standard fzf-ranked results if no Chinese name matches", () => {
  const state = createPinyinPriorityOutput();
  const files = Array.from({ length: 250 }, (_, n) => entry("dec" + n + ".c"));
  appendPinyinPriorityChunk(state, Buffer.from(files.join("\0") + "\0"));
  assert.deepEqual(
    finishPinyinPriorityOutput(state),
    files.slice(0, MAX_FZF_RESULTS),
  );
});

test("pinyin priority looks at basename only, not parent directory", () => {
  const state = createPinyinPriorityOutput();
  const files = [
    ...Array.from({ length: 160 }, (_, n) => entry("dec" + n + ".c")),
    "report.md\t/test/第二次/report.md",
    "第二次.txt\t/test/第二次.txt",
  ];
  appendPinyinPriorityChunk(state, Buffer.from(files.join("\0") + "\0"));
  const result = finishPinyinPriorityOutput(state);
  assert.ok(result.includes("第二次.txt\t/test/第二次.txt"));
  assert.equal(result.includes("report.md\t/test/第二次/report.md"), false);
});

test("memory remains bounded even if fzf prints a huge number of matching paths", () => {
  const state = createPinyinPriorityOutput();
  const record = Buffer.from(entry("dec") + "\0");
  for (let i = 0; i < MAX_PINYIN_OUTPUT_SCAN + 500; i++) {
    appendPinyinPriorityChunk(state, record);
    if (state.limitReached) break;
  }
  assert.equal(state.limitReached, true);
  assert.equal(state.scanned, MAX_PINYIN_OUTPUT_SCAN);
  assert.equal(
    finishPinyinPriorityOutput(state).length <= PINYIN_RESERVED_RESULTS + 120,
    true,
  );
  assert.ok(state.totalBytes < 8 * 1024 * 1024);
});

test("oversized result record remains a hard error", () => {
  const state = createPinyinPriorityOutput();
  assert.throws(
    () =>
      appendPinyinPriorityChunk(
        state,
        Buffer.alloc(MAX_FZF_PATH_BYTES + 1, 65),
      ),
    /size limit/,
  );
});

test("preserves unicode and NUL framing across incomplete chunks", () => {
  const state = createPinyinPriorityOutput();
  const bytes = Buffer.from(entry("第二次.txt") + "\0");
  for (let i = 0; i < bytes.length; i++)
    appendPinyinPriorityChunk(state, bytes.subarray(i, i + 1));
  assert.deepEqual(finishPinyinPriorityOutput(state), [entry("第二次.txt")]);
  assert.equal(state.pending.length, 0);
});
