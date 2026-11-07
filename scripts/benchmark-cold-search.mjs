import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createBrotliCompress, constants as zlibConstants } from "node:zlib";
import { PathPrefixEncoder } from "../src/lib/index-codec.ts";
import {
  createStreamingIndexStage,
  finalizeStreamingIndexStage,
  publishIndex,
} from "../src/lib/index-files.ts";
import { runFzfFilter } from "../src/lib/fzf-runner.ts";

const count = Number(process.argv[2] ?? "256");
if (!Number.isSafeInteger(count) || count < 1 || count > 5000)
  throw new Error("Usage: npm run benchmark:cold -- [files: 1..5000]");

// 独立临时目录不会触碰用户的 Raycast 配置和现有索引。
const root = await mkdtemp(path.join(os.tmpdir(), "pathseek-cold-"));
try {
  const fixture = path.join(root, "fixture");
  const english = path.join(fixture, "first", "second", "third");
  const chinese = path.join(fixture, "第一次", "第二次");
  await Promise.all([
    mkdir(english, { recursive: true }),
    mkdir(chinese, { recursive: true }),
  ]);
  for (let i = 0; i < count; i++)
    await writeFile(path.join(english, "four-file-" + i + ".txt"), "");
  await writeFile(path.join(chinese, "报告.txt"), "");

  const started = performance.now();
  const stage = path.join(root, "stage.tmp");
  await createStreamingIndexStage(stage);
  const scan = spawn("fd", ["--absolute-path", "--print0", ".", fixture], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const errors = [];
  scan.stderr.on("data", (chunk) => errors.push(chunk.toString("utf8")));
  let pathCount = 0;
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      for (const byte of chunk) if (byte === 0) pathCount++;
      done(null, chunk);
    },
  });
  const scanExit = new Promise((resolve, reject) => {
    scan.once("error", reject);
    scan.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("fd failed: " + errors.join("")));
    });
  });
  await Promise.all([
    pipeline(
      scan.stdout,
      meter,
      new PathPrefixEncoder(),
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 7,
          [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
        },
      }),
      createWriteStream(stage, { flags: "a" }),
    ),
    scanExit,
  ]);
  await finalizeStreamingIndexStage(stage, {
    version: 3,
    count: pathCount,
    createdAt: new Date().toISOString(),
    roots: [fixture],
  });
  await publishIndex(stage, root);
  const buildMs = performance.now() - started;

  const index = path.join(root, "index.nul");
  const queries = ["four", "fir/sec/thi/four-fi", "dyc/dec/bg"];
  const firstSearches = [];
  for (const [ordinal, query] of queries.entries()) {
    const begin = performance.now();
    const result = await runFzfFilter("fzf", index, query);
    firstSearches.push({
      id: ordinal + 1,
      elapsedMs: Number((performance.now() - begin).toFixed(2)),
      resultCount: result.paths.length,
    });
  }
  console.log(JSON.stringify({
    benchmark: "fresh-fd-index-and-first-fzf-search",
    fixtureFiles: count + 1,
    indexedPaths: pathCount,
    buildMs: Number(buildMs.toFixed(2)),
    firstSearches,
    note: "Starts without a cached index in a fresh temporary directory. No real user files or index are removed.",
  }, null, 2));
} finally {
  await rm(root, { force: true, recursive: true });
}
