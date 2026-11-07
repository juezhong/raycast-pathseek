import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareIndex, publishIndex } from "../src/lib/index-files.ts";
import {
  indexPathAt,
  legacyDevelopmentIndexDirectory,
  readStoredIndex,
} from "../src/lib/index-location.ts";

async function fixture(action) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pathseek-index-location-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function publishFixture(dir, pathname) {
  await mkdir(dir, { recursive: true });
  const raw = path.join(dir, "fixture-raw");
  const staged = path.join(dir, "fixture-stage.nul.tmp");
  await writeFile(raw, pathname + "\0");
  await prepareIndex(raw, staged, {
    version: 3,
    count: 1,
    roots: [path.dirname(pathname)],
    createdAt: "2026-11-07T00:00:00.000Z",
  });
  await publishIndex(staged, dir);
  await rm(raw);
}

test("supportPath root is authoritative in every runtime mode", async () => {
  await fixture(async (root) => {
    const legacy = legacyDevelopmentIndexDirectory(root);
    await publishFixture(legacy, "/old/legacy.c");
    await publishFixture(root, "/new/active.c");

    const before = (await readdir(root)).sort();
    const metadata = await readStoredIndex(root);
    assert.equal(metadata?.legacyDevelopmentLocation, undefined);
    assert.deepEqual(metadata?.roots, ["/new"]);
    assert.equal(indexPathAt(root, metadata), path.join(root, "index.nul"));
    assert.deepEqual((await readdir(root)).sort(), before);
    assert.equal((await stat(path.join(legacy, "index.nul"))).isFile(), true);
  });
});

test("existing development-v3 index is readable without moving or deleting it", async () => {
  await fixture(async (root) => {
    const old = legacyDevelopmentIndexDirectory(root);
    await publishFixture(old, "/old/driver.c");
    const oldData = await readFile(path.join(old, "index.nul"));

    const metadata = await readStoredIndex(root);
    assert.equal(metadata?.legacyDevelopmentLocation, true);
    assert.equal(indexPathAt(root, metadata), path.join(old, "index.nul"));
    assert.deepEqual(await readdir(root), ["index-development-v3"]);
    assert.deepEqual(await readFile(path.join(old, "index.nul")), oldData);

    await publishFixture(root, "/new/driver.c");
    const current = await readStoredIndex(root);
    assert.equal(current?.legacyDevelopmentLocation, undefined);
    assert.equal(indexPathAt(root, current), path.join(root, "index.nul"));
    assert.deepEqual(await readFile(path.join(old, "index.nul")), oldData);
  });
});

test("missing index returns null and never creates a directory", async () => {
  await fixture(async (root) => {
    const nested = path.join(root, "does-not-exist");
    assert.equal(await readStoredIndex(nested), null);
    await assert.rejects(stat(nested), { code: "ENOENT" });
  });
});

test("corrupt authoritative index is reported instead of silently using old index", async () => {
  await fixture(async (root) => {
    await publishFixture(legacyDevelopmentIndexDirectory(root), "/old/a.c");
    await writeFile(path.join(root, "index.nul"), "not a valid index");
    await assert.rejects(readStoredIndex(root), /index|header|magic|invalid/i);
  });
});

test("index path never accepts traversal even for old metadata", async () => {
  await fixture(async (root) => {
    for (const filename of ["../secret", "/tmp/index.nul", "other.nul"]) {
      assert.throws(
        () => indexPathAt(root, {
          version: 3,
          filename,
          roots: [],
          count: 0,
          createdAt: "",
          legacyDevelopmentLocation: true,
        }),
        /Invalid index filename/,
      );
    }
  });
});

test("old v1 metadata is still readable only within the selected support directory", async () => {
  await fixture(async (root) => {
    const old = legacyDevelopmentIndexDirectory(root);
    await mkdir(old);
    const filename = "index-12345678-abcd-4abc-9abc-123456789abc.nul";
    await writeFile(path.join(old, filename), "legacy-path\0");
    await writeFile(path.join(old, "index.json"), JSON.stringify({
      version: 1,
      filename,
      roots: ["/old"],
      count: 1,
      createdAt: "2025-10-24T00:00:00Z",
    }));
    const result = await readStoredIndex(root);
    assert.equal(result?.version, 1);
    assert.equal(result?.legacyDevelopmentLocation, true);
    assert.equal(indexPathAt(root, result), path.join(old, filename));
  });
});
