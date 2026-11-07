import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { openIndexDataStream, readIndexHeader } from "../src/lib/index-files.ts";

const indexPath = process.argv[2];
const query = process.argv[3];

if (!indexPath) {
  console.error('Usage: npm run benchmark:index -- "/absolute/path/to/index.nul" [query]');
  process.exitCode = 2;
} else {
  try {
    const info = await stat(indexPath);
    const metadata = await readIndexHeader(indexPath);
    const start = performance.now();
    let pathCount = 0;
    let rawBytes = 0;
    const stream = await openIndexDataStream(indexPath);
    for await (const chunk of stream) {
      rawBytes += chunk.length;
      for (const byte of chunk) if (byte === 0) pathCount++;
    }
    const decodeMs = performance.now() - start;
    const ratio = info.size ? rawBytes / info.size : NaN;
    const data = {
      formatVersion: metadata.version,
      indexedPaths: metadata.count,
      verifiedPaths: pathCount,
      rawBytes,
      compressedBytes: info.size,
      rawToCompressedRatio: Number(ratio.toFixed(2)),
      sizeReductionPercent: Number((100 * (1 - info.size / rawBytes)).toFixed(2)),
      decodeMs: Number(decodeMs.toFixed(1)),
      decodeMiBPerSecond: Number((rawBytes / (1024 * 1024) / (decodeMs / 1000)).toFixed(1)),
    };
    if (pathCount !== metadata.count) throw new Error("Index count mismatch; do not use this index");

    if (query) {
      const queryStarted = performance.now();
      const child = spawn("fzf", ["--extended", "--read0", "--print0", "--filter", query], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let matched = 0;
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        for (const byte of chunk) if (byte === 0) matched++;
      });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8").slice(0, 1024); });
      const finished = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0 || code === 1) resolve();
          else reject(new Error("fzf failed with code " + code + ": " + stderr));
        });
      });
      const reader = await openIndexDataStream(indexPath);
      await Promise.all([pipeline(reader, child.stdin), finished]);
      data.fzfSearchMs = Number((performance.now() - queryStarted).toFixed(1));
      data.matchCount = matched;
    }
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Benchmark failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
