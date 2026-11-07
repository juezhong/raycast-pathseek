import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, constants } from "node:zlib";
import { PathPrefixEncoder } from "../src/lib/index-codec.ts";
import {
  ACTIVE_INDEX_FILENAME,
  createStreamingIndexStage,
  finalizeStreamingIndexStage,
  openIndexDataStream,
  publishIndex,
  readIndexHeader,
} from "../src/lib/index-files.ts";

const [sourceIndex, destinationDirectory] = process.argv.slice(2);

if (!sourceIndex || !destinationDirectory) {
  console.error('Usage: npm run convert:index -- "/absolute/path/to/old/index.nul" "/new/nonexistent/test-directory"');
  process.exitCode = 2;
} else {
  let staged;
  try {
    if (path.resolve(sourceIndex) === path.resolve(destinationDirectory, ACTIVE_INDEX_FILENAME)) {
      throw new Error("Destination must not be the source index");
    }
    const metadata = await readIndexHeader(sourceIndex);
    const originalSize = (await stat(sourceIndex)).size;

    // 目标目录必须不存在；不覆盖用户任何已有的索引或文件。
    await mkdir(destinationDirectory);
    staged = path.join(destinationDirectory, "index-benchmark.nul.tmp");
    await createStreamingIndexStage(staged);

    let actualCount = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        for (const byte of chunk) if (byte === 0) actualCount++;
        callback(null, chunk);
      },
    });
    await pipeline(
      await openIndexDataStream(sourceIndex),
      counter,
      new PathPrefixEncoder(),
      createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_LGWIN]: 24,
        },
      }),
      createWriteStream(staged, { flags: "a" }),
    );

    if (actualCount !== metadata.count) {
      throw new Error("Source index path count mismatch; conversion aborted");
    }
    await finalizeStreamingIndexStage(staged, {
      version: 3,
      count: metadata.count,
      createdAt: metadata.createdAt,
      roots: metadata.roots,
    });
    await publishIndex(staged, destinationDirectory);
    const compressedSize = (await stat(path.join(destinationDirectory, ACTIVE_INDEX_FILENAME))).size;

    console.log(JSON.stringify({
      formatVersion: 3,
      indexedPaths: actualCount,
      originalBytes: originalSize,
      compressedBytes: compressedSize,
      sizeReductionPercent: Number((100 * (1 - compressedSize / originalSize)).toFixed(2)),
    }, null, 2));
    console.log("Conversion completed; the existing Raycast index was not modified.");
  } catch (error) {
    console.error("Conversion failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (staged) await rm(staged, { force: true }).catch(() => undefined);
  }
}
