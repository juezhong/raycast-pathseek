import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesFuzzyParentPath,
  compileFuzzyParentPathMatcher,
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


test("fzf Smart Case on directory segments: lowercase ignores case, uppercase is sensitive", () => {
  const file = "/project/SrcCore/docs/Readme.md";
  assert.equal(matchesFuzzyParentPath(file, ["src", "docs"], pinyinAlias), true);
  assert.equal(matchesFuzzyParentPath(file, ["Src", "docs"], pinyinAlias), true);
  assert.equal(matchesFuzzyParentPath(file, ["SRC", "docs"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath(file, ["src", "Docs"], pinyinAlias), false);
});

test("directory extended syntax supports exact, prefix, suffix, inverse, AND and OR", () => {
  const filepath = "/work/SourceCore/components/driver.c";
  const match = (expression) =>
    matchesFuzzyParentPath(filepath, [expression, "components"], pinyinAlias);
  for (const expression of [
    "^Source",
    "Core$",
    "'Source",
    "^SourceCore$",
    "source core",
    "^source core$",
    "!build",
    "!^test",
    "!tmp$",
    "^source | ^module",
    "^test | ^Source",
  ]) assert.equal(match(expression), true, expression);
  for (const expression of [
    "^source",
    "^SOURCE",
    "^sources",
    "sourcemissing",
    "'package",
    "!Source",
    "!^source",
    "!Core$",
    "^test | ^mod",
    "source ^invalid",
  ]) assert.equal(match(expression), false, expression);
});

test("fzf word boundaries include punctuation and underscores as separators", () => {
  const wordFile = "/root/doc-lib/assets/source.c";
  assert.equal(matchesFuzzyParentPath(wordFile, ["'doc'","assets"], pinyinAlias), true);
  assert.equal(matchesFuzzyParentPath("/root/doclib/assets/source.c", ["'doc'","assets"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath("/root/doc_utils/assets/source.c", ["'doc'","assets"], pinyinAlias), true);
});

test("Chinese aliases continue to work in each path level, advanced syntax uses original names only", () => {
  const file = "/project/第一次/第二次/说明.txt";
  assert.equal(matchesFuzzyParentPath(file, ["dyc", "derc"], pinyinAlias), true);
  assert.equal(matchesFuzzyParentPath(file, ["DYC", "DEC"], pinyinAlias), true);
  assert.equal(matchesFuzzyParentPath(file, ["yc d", "d er c"], pinyinAlias), true);
  assert.equal(matchesFuzzyParentPath(file, ["'第一次", "dec"], pinyinAlias), true);
  assert.equal(matchesFuzzyParentPath(file, ["^dyc", "dec"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath(file, ["!第一次", "dec"], pinyinAlias), false);
  assert.equal(matchesFuzzyParentPath(file, ["!dyc", "dec"], pinyinAlias), true);
});

test("the slash-free path stays outside the parser regardless of fzf syntax", () => {
  for (const raw of ["^Source", ".pdf$", "!tmp", "'abc", "abc def", "foo | bar", "dyc", "DYC"]) {
    assert.equal(parseFuzzyPathQuery(raw), null, raw);
  }
  assert.equal(parseFuzzyPathQuery("src\\lib"), null);
});

test("compiled directory matching does not generate pinyin for ASCII names", () => {
  let aliasCalls = 0;
  const matcher = compileFuzzyParentPathMatcher(["src", "lib"], (name) => {
    aliasCalls++;
    return pinyinAlias(name);
  });
  for (let i = 0; i < 100; i++) {
    assert.equal(matcher("/home/src/lib/file" + i + ".c"), true);
    assert.equal(matcher("/home/pkg/archive/file" + i + ".c"), false);
  }
  assert.equal(aliasCalls, 0);
});
