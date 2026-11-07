import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createPinyinFilterInput,
  originalPathFromPinyinResult,
  pinyinAlias,
  shouldUsePinyinAliases,
} from "../src/lib/pinyin-filter.ts";

test("Chinese phrase initials and full pinyin are generated without touching the source path", () => {
  const alias = pinyinAlias("/Users/test/第一次.txt");
  assert.match(alias, /(?:^| )dyc(?: |$)/);
  assert.match(alias, /(?:^| )diyici(?: |$)/);
  assert.equal(pinyinAlias("/Users/test/driver.c"), "");
});

test("complex fzf patterns bypass phonetic transformation", () => {
  for (const input of ["dyc", "yc d", "d y c", "y c d", "DYC", "diyici"])
    assert.equal(shouldUsePinyinAliases(input), true, input);
  for (const input of [".pdf$", "^driver", "!tmp", "'driver", "foo | bar", "你", "", "  "])
    assert.equal(shouldUsePinyinAliases(input), false, input);
});

test("streaming pinyin input preserves tabs and line breaks inside filenames across chunks", async () => {
  const first = "/docs/第一次.txt";
  const second = "/docs/abc\tdef\nfile.c";
  const original = Buffer.from(first + "\0" + second + "\0", "utf8");
  const reader = Readable.from([...original].map((byte) => Buffer.from([byte])));
  const output = [];
  for await (const chunk of reader.pipe(createPinyinFilterInput()))
    output.push(chunk);
  const records = Buffer.concat(output).toString("utf8").split("\0").filter(Boolean);
  assert.equal(records.length, 2);
  assert.equal(originalPathFromPinyinResult(records[0]), first);
  assert.equal(originalPathFromPinyinResult(records[1]), second);
  assert.match(records[0], /^dyc diyici /);
  assert.equal(records[1], "\t" + second);
});

test("streaming transformation rejects unterminated and oversize index entries", async () => {
  const pending = Readable.from([Buffer.from("/docs/unfinished")]).pipe(createPinyinFilterInput());
  await assert.rejects(async () => {
    for await (const _chunk of pending) {
      // 该输入没有 NUL 结束标记
    }
  }, /Incomplete NUL/);

  const huge = Readable.from([Buffer.alloc(1024 * 1024 + 1, 65)])
    .pipe(createPinyinFilterInput());
  await assert.rejects(async () => {
    for await (const _chunk of huge) {
      // 越界数据不能积攒无界内存
    }
  }, /size limit/);
});

test("malformed augmented output never silently returns an altered path", () => {
  assert.throws(() => originalPathFromPinyinResult("/tmp/first"), /Malformed/);
  assert.equal(originalPathFromPinyinResult("dyc\t/tmp/a\tb.txt"), "/tmp/a\tb.txt");
});
