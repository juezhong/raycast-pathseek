import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareIndex,
  publishIndex,
  openIndexDataStream,
  readIndexHeader,
} from "../src/lib/index-files.ts";

async function buildIndexFixture(action) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-stream-lifecycle-"));
  try {
    const raw = path.join(dir, "raw.paths");
    const staged = path.join(dir, "new.nul.tmp");
    const index = path.join(dir, "index.nul");
    await writeFile(raw, Buffer.from(
      Array.from({ length: 100 }, (_, i) => "/test/中文/driver" + i + ".c").join("\0") + "\0",
    ));
    await prepareIndex(raw, staged, {
      version: 3,
      count: 100,
      roots: ["/test"],
      createdAt: new Date().toISOString(),
    });
    await publishIndex(staged, dir);
    await action(index);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("corrupted Brotli payload rejects instead of hanging or returning partial index", async () => {
  await buildIndexFixture(async (index) => {
    const header = await readIndexHeader(index);
    const original = await readFile(index);
    const corrupt = Buffer.from(original);
    corrupt.fill(0xff, header.dataOffset);
    await writeFile(index, corrupt);

    const stream = await openIndexDataStream(index);
    const consume = (async () => {
      for await (const _part of stream) {}
    })();
    await assert.rejects(consume);
  });
});

test("destroying a v3 reader early closes the decompression pipeline", async () => {
  await buildIndexFixture(async (index) => {
    const reader = await openIndexDataStream(index);
    const closed = new Promise((resolve, reject) => {
      reader.once("close", resolve);
      reader.once("error", reject);
    });
    reader.destroy();
    await closed;
    assert.equal(reader.destroyed, true);
  });
});
