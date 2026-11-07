import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createBrotliCompress, createBrotliDecompress, constants } from "node:zlib";
import { PathPrefixEncoder, PathPrefixDecoder } from "../src/lib/index-codec.ts";

async function collect(stream) {
  const parts = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}

test("prefix codec roundtrips Unicode, newlines and fragmented input", async () => {
  const paths = [
    "/Users/demo/项目/驱动A.c",
    "/Users/demo/项目/驱动B.c",
    "/Users/demo/项目/long/common/path/" + "a".repeat(4096),
    "/Users/demo/项目/long/common/path/" + "a".repeat(4095) + "b",
    "/Users/demo/new\nline.txt",
    "/Users/demo/space file.txt",
  ];
  const original = Buffer.from(paths.join("\0") + "\0");
  for (const chunkSize of [1, 2, 7, 64, 4096]) {
    const chunks = [];
    for (let i = 0; i < original.length; i += chunkSize)
      chunks.push(original.subarray(i, i + chunkSize));
    const encoded = await collect(Readable.from(chunks).pipe(new PathPrefixEncoder()));
    const fragmented = [...encoded].map((byte) => Buffer.from([byte]));
    const output = await collect(Readable.from(fragmented).pipe(new PathPrefixDecoder()));
    assert.deepEqual(output, original);
  }
});

test("Brotli prefix index decompresses to exact original paths", async () => {
  const original = Buffer.from(
    Array.from({ length: 1000 }, (_, i) => "/Users/demo/source/common/" + i + ".c").join("\0") + "\0",
  );
  const compressed = await collect(
    Readable.from([original])
      .pipe(new PathPrefixEncoder())
      .pipe(createBrotliCompress({ params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_LGWIN]: 24,
      } })),
  );
  const decoded = await collect(
    Readable.from([compressed])
      .pipe(createBrotliDecompress())
      .pipe(new PathPrefixDecoder()),
  );
  assert.deepEqual(decoded, original);
  assert.ok(compressed.length < original.length);
});

test("decoder rejects corrupted prefix and truncated path", async () => {
  await assert.rejects(collect(Readable.from([Buffer.from([2, 65, 0])]).pipe(new PathPrefixDecoder())));
  await assert.rejects(collect(Readable.from([Buffer.from([0, 65])]).pipe(new PathPrefixDecoder())));
  await assert.rejects(collect(Readable.from([Buffer.from([0x80])]).pipe(new PathPrefixDecoder())));
});

test("encoder rejects an unterminated path instead of publishing partial data", async () => {
  await assert.rejects(
    collect(Readable.from([Buffer.from("/Users/demo/unfinished")]).pipe(new PathPrefixEncoder())),
  );
});
