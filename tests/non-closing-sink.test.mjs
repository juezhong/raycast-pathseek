import assert from "node:assert/strict";
import { Readable, PassThrough, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { createNonClosingSink } from "../src/lib/non-closing-sink.ts";
import { AliasPathMapper } from "../src/lib/selective-symlinks.ts";

test("20 sequential scans do not accumulate listeners on a shared compressor input", async () => {
  const shared = new PassThrough({ highWaterMark: 8 });
  const chunks = [];
  const consuming = pipeline(
    shared,
    new Writable({
      highWaterMark: 8,
      write(chunk, _encoding, callback) {
        setImmediate(() => {
          chunks.push(Buffer.from(chunk));
          callback();
        });
      },
    }),
  );
  const initialClose = shared.listenerCount("close");
  const initialError = shared.listenerCount("error");

  for (let i = 0; i < 20; i++) {
    const item = Buffer.from("/root/" + i + "/中文文件.c\0");
    await pipeline(Readable.from([item]), createNonClosingSink(shared));
    assert.equal(shared.listenerCount("close"), initialClose);
    assert.equal(shared.listenerCount("error"), initialError);
    assert.equal(shared.destroyed, false);
    assert.equal(shared.writableEnded, false);
  }

  shared.end();
  await consuming;
  const result = Buffer.concat(chunks).toString();
  for (let i = 0; i < 20; i++) {
    assert.ok(result.includes("/root/" + i + "/中文文件.c\0"));
  }
});

test("per-scan sink works after alias mapping while preserving NUL records", async () => {
  const shared = new PassThrough();
  const output = [];
  const consumer = pipeline(shared, new Writable({
    write(chunk, _encoding, callback) {
      output.push(Buffer.from(chunk));
      callback();
    },
  }));

  for (let i = 0; i < 13; i++) {
    const path = Buffer.from("/real/project/driver" + i + ".c\0");
    await pipeline(
      Readable.from([path]),
      new AliasPathMapper({ realPath: "/real/project", aliasPath: "/shortcuts/project" }),
      createNonClosingSink(shared),
    );
  }
  shared.end();
  await consumer;
  const text = Buffer.concat(output).toString("utf8");
  assert.equal(text.split("\0").filter(Boolean).length, 13);
  assert.ok(text.includes("/shortcuts/project/driver12.c\0"));
  assert.ok(!text.includes("/real/project/"));
});

test("per-scan sink rejects writing to a failed compression input", async () => {
  const shared = new PassThrough();
  shared.on("error", () => {});
  shared.destroy(new Error("writer failed"));
  await assert.rejects(
    pipeline(Readable.from([Buffer.from("test")]), createNonClosingSink(shared)),
    /closed/,
  );
});
