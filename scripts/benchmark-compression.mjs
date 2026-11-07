import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { createBrotliCompress, constants } from "node:zlib";
import { openIndexDataStream } from "../src/lib/index-files.ts";
import { PathPrefixEncoder } from "../src/lib/index-codec.ts";

const indexPath = process.argv[2];
const sampleMiB = Number(process.argv[3] ?? "2");
const includeMax = process.argv.includes("--include-max");

if (!indexPath || !Number.isInteger(sampleMiB) || sampleMiB < 1 || sampleMiB > 32) {
  console.error('Usage: npm run benchmark:quality -- "/path/to/index.nul" [sampleMiB=2] [--include-max]');
  process.exitCode = 2;
} else {
  try {
    // 最多读取 sampleMiB 原始路径，不生成任何未压缩的磁盘文件。
    const stream = await openIndexDataStream(indexPath);
    const chunks = [];
    const sampleLimit = sampleMiB * 1024 * 1024;
    let collected = 0;
    for await (const chunk of stream) {
      const part = chunk.subarray(0, Math.min(chunk.length, sampleLimit - collected));
      if (part.length) chunks.push(Buffer.from(part));
      collected += part.length;
      if (collected >= sampleLimit) break;
    }
    const input = Buffer.concat(chunks);
    const end = input.lastIndexOf(0);
    if (end < 0) throw new Error("No complete path within sample size");
    const paths = input.subarray(0, end + 1);
    const levels = includeMax ? [5, 7, 9, 11] : [5, 7, 9];
    const results = [];

    for (const quality of levels) {
      const started = performance.now();
      let compressedBytes = 0;
      const encoder = Readable.from([paths])
        .pipe(new PathPrefixEncoder())
        .pipe(createBrotliCompress({
          params: {
            [constants.BROTLI_PARAM_QUALITY]: quality,
            [constants.BROTLI_PARAM_LGWIN]: 24,
          },
        }));
      for await (const chunk of encoder) compressedBytes += chunk.length;
      results.push({
        quality,
        rawBytes: paths.length,
        compressedBytes,
        sizeReductionPercent: Number((100 * (1 - compressedBytes / paths.length)).toFixed(2)),
        elapsedMs: Number((performance.now() - started).toFixed(1)),
      });
    }
    console.log(JSON.stringify({
      samplePaths: paths.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0),
      sampleBytes: paths.length,
      levels: results,
      note: "Small-sample results do not predict exact full-index size or total rebuild time.",
    }, null, 2));
  } catch (error) {
    console.error("Compression quality benchmark failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
