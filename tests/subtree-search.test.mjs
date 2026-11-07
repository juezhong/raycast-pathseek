import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findIndexedDirectoryChoices,
  isPathInsideDirectory,
  matchesSelectedDirectory,
  parseSubtreeQuery,
} from "../src/lib/subtree-search.ts";
import { prepareIndex, publishIndex } from "../src/lib/index-files.ts";
import { parseFuzzyPathQuery } from "../src/lib/fuzzy-path-query.ts";

async function withIndex(paths, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-subtree-test-"));
  try {
    const raw = path.join(dir, "paths.raw");
    const staged = path.join(dir, "stage.nul.tmp");
    await writeFile(raw, paths.join("\0") + "\0");
    await prepareIndex(raw, staged, {
      version: 3,
      createdAt: new Date().toISOString(),
      count: paths.length,
      roots: ["/fake"],
    });
    await publishIndex(staged, dir);
    await run(path.join(dir, "index.nul"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

test("slash-space and double-slash enter subtree mode without changing normal slash syntax", () => {
  assert.deepEqual(parseSubtreeQuery("dir1/ sub-file"), {
    directoryPatterns: ["dir1"],
    directoryExpression: "dir1",
    nameQuery: "sub-file",
    marker: "/ ",
  });
  assert.deepEqual(parseSubtreeQuery("dir1/sub-dir/ so file"), {
    directoryPatterns: ["dir1", "sub-dir"],
    directoryExpression: "dir1/sub-dir",
    nameQuery: "so file",
    marker: "/ ",
  });
  assert.deepEqual(parseSubtreeQuery("raypath//.ts$"), {
    directoryPatterns: ["raypath"],
    directoryExpression: "raypath",
    nameQuery: ".ts$",
    marker: "//",
  });
  assert.equal(parseSubtreeQuery("raypath/.ts$"), null);
  assert.equal(parseSubtreeQuery("raypath/"), null);
  assert.equal(parseSubtreeQuery("plain name"), null);
  assert.deepEqual(parseFuzzyPathQuery("fir/se/thi"), {
    directoryPatterns: ["fir", "se"],
    nameQuery: "thi",
  });
  assert.throws(() => parseSubtreeQuery("raypath///.ts$"), /empty directory/);
  assert.throws(() => parseSubtreeQuery("//.ts$"), /needs a directory/);
});

test("selected directory can match the scoped path or be its highlighted direct child", () => {
  assert.equal(matchesSelectedDirectory("/projects/first", ["fir"]), true);
  assert.equal(matchesSelectedDirectory("/projects/first/second", ["fir"]), true);
  assert.equal(matchesSelectedDirectory("/projects/first/second/third", ["fir"]), false);
  assert.equal(matchesSelectedDirectory("/projects/第一次/第二次", ["dyc"]), true);
  assert.equal(matchesSelectedDirectory("/projects/other", ["fir"]), false);
});

test("exact scope prefix never includes similarly named sibling or scope root itself", () => {
  assert.equal(isPathInsideDirectory("/projects/first/child.ts", "/projects/first"), true);
  assert.equal(isPathInsideDirectory("/projects/first/sub/child.ts", "/projects/first/"), true);
  assert.equal(isPathInsideDirectory("/projects/first-other/child.ts", "/projects/first"), false);
  assert.equal(isPathInsideDirectory("/projects/first/", "/projects/first"), false);
  assert.equal(isPathInsideDirectory("/projects/first", "/projects/first"), false);
  assert.equal(isPathInsideDirectory("/a", "/"), true);
  assert.equal(isPathInsideDirectory("/another", "/a"), false);
});

test("directory picker discovers unique and multiple real indexed parent directories", async () => {
  await withIndex([
    "/projects/raypath/src/driver.ts",
    "/projects/raypath/src/nested/other.js",
    "/projects/raypath/src/一次.txt",
    "/projects/other/raypath/test.ts",
    "/projects/raypath2/rewrite.ts",
    "/projects/first/second/third/example.ts",
    "/projects/first/second/third/source.ts",
    "/projects/第一次/第二次/报告.ts",
    "/projects/empty/",
  ], async (index) => {
    const multi = await findIndexedDirectoryChoices(index, ["raypath"]);
    assert.deepEqual(multi.paths, [
      "/projects/other/raypath",
      "/projects/raypath",
      "/projects/raypath2",
    ]);
    assert.equal(multi.truncated, false);

    const single = await findIndexedDirectoryChoices(index, ["raypath", "src"]);
    assert.deepEqual(single.paths, ["/projects/raypath/src"]);
    assert.equal(single.truncated, false);

    const chinese = await findIndexedDirectoryChoices(index, ["dyc", "dec"]);
    assert.deepEqual(chinese.paths, ["/projects/第一次/第二次"]);

    const empty = await findIndexedDirectoryChoices(index, ["empty"]);
    assert.deepEqual(empty.paths, ["/projects/empty"]);

    const missing = await findIndexedDirectoryChoices(index, ["absent"]);
    assert.deepEqual(missing.paths, []);
  });
});

test("directory choice cap reports ambiguity and cannot pretend the first match is unique", async () => {
  await withIndex(
    Array.from({ length: 100 }, (_, i) =>
      "/root/ray-folder-" + i + "/src/main.ts"
    ),
    async (index) => {
      const match = await findIndexedDirectoryChoices(index, ["ray"], undefined, 5);
      assert.equal(match.paths.length, 5);
      assert.equal(match.truncated, true);
    },
  );
});

test("aborted directory lookup never continues searching the index", async () => {
  await withIndex(["/some/dir/filename.txt"], async (index) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      findIndexedDirectoryChoices(index, ["dir"], controller.signal),
    );
  });
});
