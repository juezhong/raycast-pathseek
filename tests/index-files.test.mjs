import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ACTIVE_INDEX_FILENAME,
  cleanupLegacyIndexes,
  publishIndex,
} from "../src/lib/index-files.ts";

async function withDirectory(action) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-index-test-"));
  try {
    await action(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("atomic replacement keeps a stable pathname for readers", async () => {
  await withDirectory(async (dir) => {
    const active = path.join(dir, ACTIVE_INDEX_FILENAME);
    await writeFile(active, "old-entry\0");
    const readerPath = active;
    const staged = path.join(dir, "index-staging.nul.tmp");
    await writeFile(staged, "new-entry\0");

    await publishIndex(staged, dir);

    assert.equal(await readFile(readerPath, "utf8"), "new-entry\0");
    assert.deepEqual(await readdir(dir), [ACTIVE_INDEX_FILENAME]);
  });
});

test("an already open reader retains the old complete content after rename", async () => {
  await withDirectory(async (dir) => {
    const active = path.join(dir, ACTIVE_INDEX_FILENAME);
    await writeFile(active, "old\0");
    const handle = await import("node:fs/promises").then((fs) => fs.open(active, "r"));
    try {
      const staged = path.join(dir, "new.tmp");
      await writeFile(staged, "new\0");
      await publishIndex(staged, dir);
      assert.equal((await handle.readFile()).toString(), "old\0");
      assert.equal(await readFile(active, "utf8"), "new\0");
    } finally {
      await handle.close();
    }
  });
});

test("failed preparation preserves the previous index", async () => {
  await withDirectory(async (dir) => {
    const active = path.join(dir, ACTIVE_INDEX_FILENAME);
    await writeFile(active, "healthy\0");
    await assert.rejects(publishIndex(path.join(dir, "missing.tmp"), dir));
    assert.equal(await readFile(active, "utf8"), "healthy\0");
  });
});

test("legacy cleanup preserves current file and too-recent legacy files", async () => {
  await withDirectory(async (dir) => {
    await writeFile(path.join(dir, ACTIVE_INDEX_FILENAME), "active\0");
    await writeFile(path.join(dir, "index.json"), JSON.stringify({ filename: ACTIVE_INDEX_FILENAME }));

    const old = path.join(dir, "index-11111111-1111-4111-8111-111111111111.nul");
    const recent = path.join(dir, "index-22222222-2222-4222-8222-222222222222.nul");
    await writeFile(old, "older\0");
    await writeFile(recent, "recent\0");
    const past = new Date(Date.now() - 3 * 24 * 3600_000);
    await utimes(old, past, past);
    const removed = await cleanupLegacyIndexes(dir);
    assert.equal(removed, 1);
    assert.equal(await readFile(path.join(dir, ACTIVE_INDEX_FILENAME), "utf8"), "active\0");
    assert.equal(await readFile(recent, "utf8"), "recent\0");

    // Never delete the only valid active index, even with an empty legacy set.
    assert.equal(await cleanupLegacyIndexes(dir, Date.now() + 4 * 24 * 3600_000), 1);
    assert.deepEqual((await readdir(dir)).sort(), ["index.json", ACTIVE_INDEX_FILENAME].sort());
  });
});

test("legacy cleanup does not run before stable index metadata is published", async () => {
  await withDirectory(async (dir) => {
    const oldName = "index-33333333-3333-4333-8333-333333333333.nul";
    const old = path.join(dir, oldName);
    await writeFile(old, "old\0");
    await writeFile(path.join(dir, "index.json"), JSON.stringify({ filename: oldName }));
    const past = new Date(Date.now() - 3 * 24 * 3600_000);
    await utimes(old, past, past);
    assert.equal(await cleanupLegacyIndexes(dir), 0);
    assert.equal(await readFile(old, "utf8"), "old\0");
  });
});
