import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, constants } from "node:zlib";
import { PathPrefixEncoder } from "../src/lib/index-codec.ts";
import {
  createStreamingIndexStage,
  finalizeStreamingIndexStage,
  openIndexDataStream,
  publishIndex,
} from "../src/lib/index-files.ts";
import { runFzfFilter } from "../src/lib/fzf-runner.ts";
import { registerChild, terminateChild } from "../src/lib/managed-child.ts";
import { createNonClosingSink } from "../src/lib/non-closing-sink.ts";
import {
  AliasPathMapper,
  discoverSelectiveSymlinks,
} from "../src/lib/selective-symlinks.ts";

function summarizeTimes(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    runs: sorted.length,
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    maxMs: Number(sorted.at(-1).toFixed(2)),
  };
}

function usageDelta(cpu) {
  return {
    userMs: Math.round(cpu.user / 1000),
    systemMs: Math.round(cpu.system / 1000),
  };
}

function options(argv) {
  if (!argv.length || argv[0].startsWith("--")) {
    throw new Error("Usage: npm run benchmark:standalone -- \"$HOME\" [--shortcuts \"$HOME/Symlinks\"] [--hidden] [--quality 7] [--runs 5]");
  }
  const root = path.resolve(argv[0]);
  let shortcuts = null;
  let hidden = false;
  let quality = 7;
  let runs = 5;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--shortcuts" && i + 1 < argv.length) {
      shortcuts = path.resolve(argv[++i]);
    } else if (argv[i] === "--hidden") {
      hidden = true;
    } else if (argv[i] === "--quality" && i + 1 < argv.length) {
      quality = Number(argv[++i]);
    } else if (argv[i] === "--runs" && i + 1 < argv.length) {
      runs = Number(argv[++i]);
    } else {
      throw new Error("Unknown or incomplete benchmark option");
    }
  }
  if (![5, 7, 9, 11].includes(quality)) {
    throw new Error("Compression quality must be 5, 7, 9, or 11");
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
    throw new Error("Repeat count must be an integer between 1 and 10");
  }
  return { root, shortcuts, hidden, quality, runs };
}

async function scanFd(root, sink, counters, signal, shortcut) {
  if (signal.aborted) throw new Error("Benchmark cancelled");

  const args = ["--absolute-path", "--print0"];
  if (counters.hidden) args.push("--hidden");
  args.push("--exclude", ".git", "--exclude", "node_modules", ".", root);

  const child = spawn("fd", args, { stdio: ["ignore", "pipe", "pipe"] });
  registerChild(child);
  child.stderr.resume(); // 不输出可能包含私人路径的扫描日志。

  const onAbort = () => terminateChild(child);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("fd scan failed with exit status " + code));
    });
  });

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      counters.rawBytes += chunk.length;
      for (let i = chunk.indexOf(0); i !== -1; i = chunk.indexOf(0, i + 1)) {
        counters.paths++;
      }
      // 只抽取搜索样本，不保存任何完整文件路径或文件名。
      if (!counters.sample && counters.rawBytes < 8 * 1024 * 1024) {
        for (const candidate of chunk.toString("utf8").split("\0")) {
          const name = path.basename(candidate);
          const tokens = name.match(/[A-Za-z0-9]{4,16}/g);
          if (tokens?.length) {
            counters.sample = tokens[0];
            break;
          }
        }
      }
      callback(null, chunk);
    },
  });

  const transfer = shortcut
    ? pipeline(
        child.stdout,
        new AliasPathMapper(shortcut),
        meter,
        createNonClosingSink(sink),
      )
    : pipeline(child.stdout, meter, createNonClosingSink(sink));

  try {
    await Promise.all([completed, transfer]);
    if (signal.aborted) throw new Error("Benchmark cancelled");
  } catch (error) {
    terminateChild(child);
    await Promise.allSettled([completed, transfer]);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function measureDecode(index) {
  const started = performance.now();
  let paths = 0;
  let rawBytes = 0;
  const stream = await openIndexDataStream(index);
  for await (const chunk of stream) {
    rawBytes += chunk.length;
    for (let i = chunk.indexOf(0); i !== -1; i = chunk.indexOf(0, i + 1)) {
      paths++;
    }
  }
  return { paths, rawBytes, elapsedMs: Number((performance.now() - started).toFixed(1)) };
}

async function run() {
  const args = options(process.argv.slice(2));
  const info = await stat(args.root);
  if (!info.isDirectory()) throw new Error("Index root is not a directory");

  const discovery = args.shortcuts
    ? await discoverSelectiveSymlinks(args.shortcuts, args.hidden)
    : { targets: [], linksSkipped: 0 };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pathseek-benchmark-"));
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  try {
    const stage = path.join(temporary, "stage.nul.tmp");
    const index = path.join(temporary, "index.nul");
    await createStreamingIndexStage(stage);

    const input = new PassThrough({ highWaterMark: 1024 * 1024 });
    const compressed = pipeline(
      input,
      new PathPrefixEncoder(),
      createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: args.quality,
          [constants.BROTLI_PARAM_LGWIN]: 24,
        },
      }),
      createWriteStream(stage, { flags: "a" }),
    );
    void compressed.catch(() => undefined);
    const onAbort = () => input.destroy(new Error("Benchmark cancelled"));
    controller.signal.addEventListener("abort", onAbort, { once: true });

    const counters = { paths: 0, rawBytes: 0, sample: "", hidden: args.hidden };
    const started = performance.now();
    const buildCpuStart = process.cpuUsage();
    try {
      await scanFd(args.root, input, counters, controller.signal);
      for (const alias of discovery.targets) {
        await scanFd(alias.realPath, input, counters, controller.signal, alias);
      }
      if (controller.signal.aborted) throw new Error("Benchmark cancelled");
      input.end();
      await compressed;
    } catch (error) {
      input.destroy(error);
      await compressed.catch(() => undefined);
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
    }
    const buildMs = Number((performance.now() - started).toFixed(1));
    const buildCpu = usageDelta(process.cpuUsage(buildCpuStart));
    await finalizeStreamingIndexStage(stage, {
      version: 3,
      count: counters.paths,
      createdAt: new Date().toISOString(),
      roots: [args.root],
    });
    await publishIndex(stage, temporary);
    const indexBytes = (await stat(index)).size;

    const decodeCpuStart = process.cpuUsage();
    const decoded = await measureDecode(index);
    const decodeCpu = usageDelta(process.cpuUsage(decodeCpuStart));
    if (decoded.paths !== counters.paths || decoded.rawBytes !== counters.rawBytes) {
      throw new Error("Compressed index round-trip verification failed");
    }

    const tests = [
      { kind: "frequent-early-limit", query: "a", timings: [], count: 0, limited: false },
      { kind: "sampled-existing-filename", query: counters.sample || "src", timings: [], count: 0, limited: false },
      { kind: "full-scan-no-match", query: "pathseek_absent_" + randomUUID().replaceAll("-", ""), timings: [], count: 0, limited: false },
    ];
    const searchCpuStart = process.cpuUsage();
    // 第一轮为预热，不计入统计。之后交错测试三种负载，避免顺序偏差。
    for (let round = 0; round <= args.runs; round++) {
      for (const entry of tests) {
        if (controller.signal.aborted) throw new Error("Benchmark cancelled");
        const startedQuery = performance.now();
        const result = await runFzfFilter("fzf", index, entry.query, controller.signal);
        const elapsed = performance.now() - startedQuery;
        if (round > 0) entry.timings.push(elapsed);
        entry.count = result.paths.length;
        entry.limited = result.limited;
        if (result.cancelled) throw new Error("Search cancelled");
      }
    }
    const searchCpu = usageDelta(process.cpuUsage(searchCpuStart));
    const measurements = tests.map((entry) => ({
      kind: entry.kind,
      ...summarizeTimes(entry.timings),
      resultCount: entry.count,
      limitReached: entry.limited,
    }));
    if (tests[2].count !== 0) throw new Error("No-match control unexpectedly matched");

    return {
      benchmarkVersion: 2,
      formatVersion: 3,
      host: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        availableParallelism: os.availableParallelism(),
      },
      scanRoots: 1 + discovery.targets.length,
      symlinkTargets: discovery.targets.length,
      symlinkLinksSkipped: discovery.linksSkipped,
      includeHidden: args.hidden,
      compressionQuality: args.quality,
      indexedPaths: counters.paths,
      uncompressedBytes: counters.rawBytes,
      compressedBytes: indexBytes,
      compressionSavingsPercent: Number(
        (100 * (1 - indexBytes / Math.max(1, counters.rawBytes))).toFixed(2),
      ),
      buildMs,
      buildCpu,
      decodedPaths: decoded.paths,
      decodeMs: decoded.elapsedMs,
      decodeCpu,
      searchCpu,
      warmupRounds: 1,
      measuredRounds: args.runs,
      queries: measurements,
      note: "Build/decode/search CPU times only include the Node process, not fd/fzf. No path or query text is emitted.",
    };
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
    // 仅删除 mkdtemp 本次创建的临时目录；绝不操作 Raycast 正式索引。
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const code = error?.code && /^[A-Z0-9_-]+$/.test(error.code) ? error.code : "UNKNOWN";
  console.error("Benchmark failed (" + code + "). Check fd/fzf availability and selected directories.");
  process.exitCode = 1;
}
