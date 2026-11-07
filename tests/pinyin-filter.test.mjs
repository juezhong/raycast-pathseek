import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createPinyinFilterInput,
  originalPathFromPinyinResult,
  pinyinAlias,
  shouldPrioritizePinyinResults,
} from "../src/lib/pinyin-filter.ts";

test("Chinese phrase initials and full pinyin are generated without touching the source path", () => {
  const alias = pinyinAlias("第一次.txt");
  assert.match(alias, /(?:^| )dyc(?: |$)/);
  assert.match(alias, /(?:^| )diyici(?: |$)/);
  assert.equal(pinyinAlias("/Users/test/driver.c"), "");
});

test("complex fzf patterns do not request special pinyin result priority", () => {
  for (const input of [
    "dyc",
    "yc d",
    "d y c",
    "y c d",
    "DYC",
    "diyici",
    "2026 dyc",
  ])
    assert.equal(shouldPrioritizePinyinResults(input), true, input);
  for (const input of [
    ".pdf$",
    "^driver",
    "!tmp",
    "'driver",
    "foo | bar",
    "你",
    "",
    "  ",
  ])
    assert.equal(shouldPrioritizePinyinResults(input), false, input);
});

test("streaming pinyin input preserves tabs and line breaks inside filenames across chunks", async () => {
  const first = "/docs/第一次.txt";
  const second = "/docs/abc\tdef\nfile.c";
  const original = Buffer.from(first + "\0" + second + "\0", "utf8");
  const reader = Readable.from(
    [...original].map((byte) => Buffer.from([byte])),
  );
  const output = [];
  for await (const chunk of reader.pipe(createPinyinFilterInput()))
    output.push(chunk);
  const records = Buffer.concat(output)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  assert.equal(records.length, 2);
  assert.equal(originalPathFromPinyinResult(records[0]), first);
  assert.equal(originalPathFromPinyinResult(records[1]), second);
  assert.match(records[0], /^第一次\.txt dyc diyici /);
  assert.equal(records[1], "abc def\nfile.c\t" + second);
});

test("streaming transformation rejects unterminated and oversize index entries", async () => {
  const pending = Readable.from([Buffer.from("/docs/unfinished")]).pipe(
    createPinyinFilterInput(),
  );
  await assert.rejects(async () => {
    for await (const _chunk of pending) {
      // 该输入没有 NUL 结束标记
    }
  }, /Incomplete NUL/);

  const huge = Readable.from([Buffer.alloc(1024 * 1024 + 1, 65)]).pipe(
    createPinyinFilterInput(),
  );
  await assert.rejects(async () => {
    for await (const _chunk of huge) {
      // 越界数据不能积攒无界内存
    }
  }, /size limit/);
});

test("malformed augmented output never silently returns an altered path", () => {
  assert.throws(() => originalPathFromPinyinResult("/tmp/first"), /Malformed/);
  assert.equal(
    originalPathFromPinyinResult("dyc\t/tmp/a\tb.txt"),
    "/tmp/a\tb.txt",
  );
});

test("only the current entry name is searchable, never its parent directory", async () => {
  const entries = [
    "/projects/2026/第一次.txt",
    "/projects/第一次/2026_report.txt",
    "/projects/2026/2026第一次.txt",
    "/projects/2026/driver.c",
  ];
  const input = Buffer.from(entries.join("\0") + "\0");
  const chunks = [];
  for await (const chunk of Readable.from([input]).pipe(
    createPinyinFilterInput(true),
  ))
    chunks.push(chunk);
  const records = Buffer.concat(chunks)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  assert.equal(records.length, entries.length);
  assert.equal(records[0].split("\t")[0], "第一次.txt dyc diyici DYC DIYICI");
  assert.equal(records[1].split("\t")[0], "2026_report.txt");
  assert.equal(
    records[2].split("\t")[0],
    "2026第一次.txt dyc diyici DYC DIYICI",
  );
  assert.equal(records[3].split("\t")[0], "driver.c");
  assert.deepEqual(records.map(originalPathFromPinyinResult), entries);
});

test("native fzf operator queries do not insert pinyin aliases", async () => {
  const path = "/parent/第一次/2026_driver.txt";
  const output = [];
  for await (const chunk of Readable.from([Buffer.from(path + "\0")]).pipe(
    createPinyinFilterInput(false),
  ))
    output.push(chunk);
  assert.equal(
    Buffer.concat(output).toString("utf8"),
    "2026_driver.txt\t" + path + "\0",
  );
});

test("ASCII basename fast path is byte-exact and does not expose parent text", async () => {
  const entries = [
    "/中文父目录/driver.c",
    "/ASCII/SOURCE_DRIVER.H",
    "/ASCII/subdir/",
    "/ASCII/quote'word.c",
    "/ASCII/file name.txt",
    "/ASCII/tab\\tname.c",
    "/ASCII/café.txt",
    "/ASCII/第一次.txt",
    "/ASCII/line\\nbreak.c",
  ];
  const input = Buffer.from(entries.join("\\0") + "\\0", "utf8");
  const output = [];
  for await (const chunk of Readable.from([input]).pipe(
    createPinyinFilterInput(true),
  )) output.push(chunk);
  const records = Buffer.concat(output).toString("utf8").split("\\0").filter(Boolean);
  assert.equal(records.length, entries.length);
  assert.deepEqual(records.map(originalPathFromPinyinResult), entries);
  assert.equal(records[0], "driver.c\\t" + entries[0]);
  assert.equal(records[1], "SOURCE_DRIVER.H\\t" + entries[1]);
  assert.equal(records[2], "subdir\\t" + entries[2]);
  assert.equal(records[3], "quote'word.c\\t" + entries[3]);
  assert.equal(records[4], "file name.txt\\t" + entries[4]);
  assert.equal(records[5], "tab name.c\\t" + entries[5]);
  assert.equal(records[6], "café.txt\\t" + entries[6]);
  assert.match(records[7], /^第一次\\.txt dyc diyici /);
  assert.equal(records[8], "line\\nbreak.c\\t" + entries[8]);
});
