import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
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


const execFileAsync = promisify(execFile);

/**
 * 仅基准测试期间采样同一 Node 进程树的 RSS。
 * ps 本身和它的子进程不纳入统计；短生命周期进程可能落在采样间隔之间。
 */
function createProcessTreeMemorySampler(sampleIntervalMs = 250) {
  const state = {
    sampled: 0,
    failures: 0,
    peakCombinedRssBytes: 0,
    peakFdRssBytes: 0,
    peakFzfRssBytes: 0,
    peakOtherChildRssBytes: 0,
    observedFd: false,
    observedFzf: false,
  };
  let inFlight = null;
  let stopped = false;

  function capture() {
    if (inFlight || stopped) return inFlight;
    inFlight = execFileAsync("ps", ["-axo", "pid=,ppid=,rss=,comm="], {
      timeout: 3000,
      maxBuffer: 8 * 1024 * 1024,
    }).then(({ stdout }) => {
      const entries = new Map();
      for (const line of stdout.split("\n")) {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
        if (!match) continue;
        entries.set(Number(match[1]), {
          parent: Number(match[2]),
          rssBytes: Number(match[3]) * 1024,
          name: path.basename(match[4]),
        });
      }
      const descendants = new Set([process.pid]);
      // 只追踪基准进程的后代，其他程序即使也叫 fd/fzf 也不计入。
      for (let changed = true; changed;) {
        changed = false;
        for (const [pid, entry] of entries) {
          if (descendants.has(pid) || !descendants.has(entry.parent) || entry.name === "ps")
            continue;
          descendants.add(pid);
          changed = true;
        }
      }

      let combinedBytes = 0;
      let fdBytes = 0;
      let fzfBytes = 0;
      let otherBytes = 0;
      for (const pid of descendants) {
        const item = entries.get(pid);
        if (!item) continue;
        combinedBytes += item.rssBytes;
        if (pid === process.pid) continue;
        if (item.name === "fd" || item.name === "fdfind") fdBytes += item.rssBytes;
        else if (item.name === "fzf") fzfBytes += item.rssBytes;
        else otherBytes += item.rssBytes;
      }
      state.sampled++;
      state.peakCombinedRssBytes = Math.max(state.peakCombinedRssBytes, combinedBytes);
      state.peakFdRssBytes = Math.max(state.peakFdRssBytes, fdBytes);
      state.peakFzfRssBytes = Math.max(state.peakFzfRssBytes, fzfBytes);
      state.peakOtherChildRssBytes = Math.max(state.peakOtherChildRssBytes, otherBytes);
      state.observedFd ||= fdBytes > 0;
      state.observedFzf ||= fzfBytes > 0;
    }).catch(() => {
      state.failures++;
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  const timer = setInterval(() => { void capture(); }, sampleIntervalMs);
  timer.unref();
  void capture();

  return {
    async finish() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
      return {
        ...state,
        sampleIntervalMs,
        scope: "Periodic RSS sample of this Node process and its fd/fzf descendants; short bursts can be missed. Does not include file cache, Raycast, or unrelated processes.",
      };
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function options(argv) {
  if (!argv.length || argv[0].startsWith("--")) {
    throw new Error("Usage: npm run benchmark:standalone -- \"$HOME\" [--shortcuts \"$HOME/Symlinks\"] [--hidden] [--quality 7] [--runs 5] [--compare]");
  }
  const root = path.resolve(argv[0]);
  let shortcuts = null;
  let hidden = false;
  let quality = 7;
  let runs = 5;
  let compare = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--shortcuts" && i + 1 < argv.length) {
      shortcuts = path.resolve(argv[++i]);
    } else if (argv[i] === "--hidden") {
      hidden = true;
    } else if (argv[i] === "--quality" && i + 1 < argv.length) {
      quality = Number(argv[++i]);
    } else if (argv[i] === "--runs" && i + 1 < argv.length) {
      runs = Number(argv[++i]);
    } else if (argv[i] === "--compare") {
      compare = true;
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
  return { root, shortcuts, hidden, quality, runs, compare };
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

  let samplePending = Buffer.alloc(0);
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      counters.rawBytes += chunk.length;
      for (let i = chunk.indexOf(0); i !== -1; i = chunk.indexOf(0, i + 1)) {
        counters.paths++;
      }
      // 仅短暂从扫描数据中抽取查询词，输出不包含文件名和路径。
      if (counters.compare && !counters.sampledPathQuery) {
        // fd 的路径可能跨 chunk；只从完整 NUL 记录采样，不能拿截断路径拼查询。
        const records = samplePending.length
          ? Buffer.concat([samplePending, chunk])
          : chunk;
        let start = 0;
        while (start < records.length) {
          const end = records.indexOf(0, start);
          if (end < 0) break;
          const candidate = records.subarray(start, end).toString("utf8");
          const name = path.basename(candidate);
          const parent = path.basename(path.dirname(candidate));
          const leaf = name.match(/[A-Za-z0-9]{3,16}/)?.[0];
          const ancestor = parent.match(/[A-Za-z0-9]{3,16}/)?.[0];
          if (candidate.startsWith("/") && leaf && ancestor) {
            counters.sampledPathQuery =
              (ancestor.slice(0, 3) + "/" + leaf.slice(0, 3)).toLowerCase();
            counters.sampledLeafQuery = leaf.slice(0, 3).toLowerCase();
            break;
          }
          start = end + 1;
        }
        samplePending = counters.sampledPathQuery
          ? Buffer.alloc(0)
          : Buffer.from(records.subarray(start));
        if (samplePending.length > 1024 * 1024) samplePending = Buffer.alloc(0);
      }
      // 只抽取搜索样本，不保存任何完整文件路径或文件名。
      if (!counters.sample && counters.rawBytes < 8 * 1024 * 1024) {
        // 只使用以 NUL 结束的完整记录，避免选到跨 chunk 的半截文件名。
        for (const candidate of chunk.toString("utf8").split("\0").slice(0, -1)) {
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
  // 仅在用户显式运行 benchmark 时采样；不修改插件搜索组件，也不常驻。
  const rssAtStart = process.memoryUsage.rss();
  let sampledPeakRss = rssAtStart;
  const rssSampler = setInterval(() => {
    sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage.rss());
  }, 50);
  rssSampler.unref();
  const processTreeSampler = createProcessTreeMemorySampler();
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

    const counters = {
      paths: 0,
      rawBytes: 0,
      sample: "",
      hidden: args.hidden,
      compare: args.compare,
      sampledPathQuery: "",
      sampledLeafQuery: "",
    };
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
    await finalizeStreamingIndexStage(stage, {
      version: 3,
      count: counters.paths,
      createdAt: new Date().toISOString(),
      roots: [args.root],
    });
    await publishIndex(stage, temporary);
    const indexBytes = (await stat(index)).size;
    const buildMs = Number((performance.now() - started).toFixed(1));
    const buildCpu = usageDelta(process.cpuUsage(buildCpuStart));

    // 同一份索引先预热，再重复完整解压，避免单次缓存波动影响判断。
    const decodeCpuStart = process.cpuUsage();
    const decodeTimings = [];
    let decoded;
    for (let round = 0; round <= args.runs; round++) {
      if (controller.signal.aborted) throw new Error("Benchmark cancelled");
      decoded = await measureDecode(index);
      if (decoded.paths !== counters.paths || decoded.rawBytes !== counters.rawBytes) {
        throw new Error("Compressed index round-trip verification failed");
      }
      if (round > 0) decodeTimings.push(decoded.elapsedMs);
    }
    const decodeStats = summarizeTimes(decodeTimings);
    const decodeCpu = usageDelta(process.cpuUsage(decodeCpuStart));

    const tests = [
      { kind: "frequent-early-limit", query: "a", timings: [], count: 0, limited: false },
      { kind: "sampled-existing-filename", query: counters.sample || "src", timings: [], count: 0, limited: false },
      { kind: "full-scan-no-match", query: "pathseek_absent_" + randomUUID().replaceAll("-", ""), timings: [], count: 0, limited: false },
    ];
    if (args.compare && counters.sampledPathQuery) {
      // 两类搜索使用同一条真实索引记录生成查询词，但匹配范围不同。
      tests.push(
        { kind: "compare-leaf-fuzzy", query: counters.sampledLeafQuery, timings: [], count: 0, limited: false },
        { kind: "compare-direct-parent-fuzzy", query: counters.sampledPathQuery, timings: [], count: 0, limited: false },
      );
    }
    if (args.compare) {
      // 固定拼音路径负载，即使无匹配结果也完整走一遍路径/拼音查询管线。
      tests.push({
        kind: "compare-pinyin-parent-path",
        query: "dyc/dec",
        timings: [],
        count: 0,
        limited: false,
      });
    }
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

    const processTreeRss = await processTreeSampler.finish();
    return {
      benchmarkVersion: 3,
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
      compareRequested: args.compare,
      comparison: args.compare
        ? {
            available: Boolean(counters.sampledPathQuery),
            modes: ["basename-only", "consecutive-parent-path", "pinyin-parent-path"],
            note: "Same indexed fixture: compare basename, consecutive-parent path, and a fixed pinyin path workload; not an old-version/new-version comparison.",
          }
        : undefined,
      indexedPaths: counters.paths,
      uncompressedBytes: counters.rawBytes,
      compressedBytes: indexBytes,
      compressionSavingsPercent: Number(
        (100 * (1 - indexBytes / Math.max(1, counters.rawBytes))).toFixed(2),
      ),
      buildMs,
      buildCpu,
      processTreeRss,
      nodeRss: {
        atStartBytes: rssAtStart,
        afterBenchmarkBytes: process.memoryUsage.rss(),
        sampledPeakBytes: Math.max(sampledPeakRss, process.memoryUsage.rss()),
        sampleIntervalMs: 50,
        scope: "Benchmark Node process only; excludes fd/fzf and Raycast",
      },
      decodedPaths: decoded.paths,
      decodeMs: decodeStats.p50Ms,
      decodeStats,
      decodeCpu,
      searchCpu,
      warmupRounds: 1,
      measuredRounds: args.runs,
      queries: measurements,
      note: "CPU times are Node-only; RSS also includes periodically sampled fd/fzf descendants in processTreeRss. No path or query text is emitted.",
    };
  } finally {
    clearInterval(rssSampler);
    processTreeSampler.stop();
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
