import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesFuzzyParentPath,
  parseFuzzyPathQuery,
} from "../src/lib/fuzzy-path-query.ts";
import { pinyinAlias } from "../src/lib/pinyin-filter.ts";

test("slash syntax divides consecutive directory levels from final fzf filename term", () => {
  assert.deepEqual(parseFuzzyPathQuery("th/for"), {
    directoryPatterns: ["th"],
    nameQuery: "for",
  });
  assert.deepEqual(parseFuzzyPathQuery("third/fou"), {
    directoryPatterns: ["third"],
    nameQuery: "fou",
  });
  assert.deepEqual(parseFuzzyPathQuery("fir/seco/th/four"), {
    directoryPatterns: ["fir", "seco", "th"],
    nameQuery: "four",
  });
  assert.deepEqual(parseFuzzyPathQuery("/first/seco"), {
    directoryPatterns: ["first"],
    nameQuery: "seco",
  });
  assert.deepEqual(parseFuzzyPathQuery("th/"), {
    directoryPatterns: ["th"],
    nameQuery: "",
  });
  assert.equal(parseFuzzyPathQuery("plain-basename"), null);
  assert.throws(() => parseFuzzyPathQuery("fir//four"), /empty directory/);
  assert.throws(() => parseFuzzyPathQuery("//four"), /empty directory/);
});

test("each ancestor part independently matches a *direct* parent level", () => {
  const target = "/root/first/second/third/fourth";
  for (const input of ["th/for", "third/fou", "fir/seco/th/four"]) {
    const parsed = parseFuzzyPathQuery(input);
    assert.equal(matchesFuzzyParentPath(target, parsed.directoryPatterns, pinyinAlias), true, input);
  }
  assert.equal(matchesFuzzyParentPath("/root/first/second/third/archive/fourth", ["th"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath(target, ["fir", "th"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath("/root/first/third/fourth", ["seco", "th"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath("/root/forfirthird/fourth", ["fir", "th"], pinyinAlias), false);
});

test("directory pinyin is dynamically recognized with common initials and full syllables", () => {
  const target = "/root/第一次/第二次.txt";
  for (const pat of ["dyc", "diyici", "d y c", "yc d"]) {
    assert.equal(matchesFuzzyParentPath(target, [pat], pinyinAlias), true, pat);
  }
  assert.equal(matchesFuzzyParentPath(target, ["dec"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath("/root/第二次/普通文件", ["dec"], pinyinAlias), true);
});

test("native non-slash search retains its existing meaning", () => {
  assert.equal(parseFuzzyPathQuery("dyc"), null);
  assert.equal(parseFuzzyPathQuery("driver .c$"), null);
  assert.equal(parseFuzzyPathQuery(".pdf$"), null);
});
