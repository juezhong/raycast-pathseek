import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { openIndexDataStream } from "../src/lib/index-files.ts";
import {
  appendFzfOutputChunk,
  createFzfOutputState,
  MAX_FZF_RESULTS,
} from "../src/lib/fzf-output.ts";
import { registerChild, terminateChild } from "../src/lib/managed-child.ts";

const STRATEGIES = [
  { id: "sorted-compressed", noSort: false, useMemory: false },
  { id: "unsorted-compressed", noSort: true, useMemory: false },
  { id: "sorted-memory", noSort: false, useMemory: true },
  { id: "unsorted-memory", noSort: true, useMemory: true },
];

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => Number(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)].toFixed(2));
  return {
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: Number(sorted.at(-1).toFixed(2)),
  };
}

/** 比较策略仅将解压后的 NUL 路径保存在内存中，不生成未压缩路径文件。 */
async function preloadPaths(indexPath, signal) {
  const chunks = [];
  let bytes = 0;
  const reader = await openIndexDataStream(indexPath);
  try {
    for await (const chunk of reader) {
      if (signal.aborted) throw new Error("Benchmark cancelled");
      chunks.push(Buffer.from(chunk));
      bytes += chunk.length;
    }
  } finally {
    reader.destroy();
  }
  return { chunks, bytes };
}

/**
 * 与生产环境保持相同的 fzf 输入和 150 条上限；
 * 仅测试脚本允许追加 --no-sort，以及选择内存中的解压结果作为输入。
 */
async function measureFilter(indexPath, query, strategy, rawChunks, signal) {
  if (signal.aborted) throw new Error("Benchmark cancelled");
  const started = performance.now();
  const input = strategy.useMemory
    ? Readable.from(rawChunks, { objectMode: false })
    : await openIndexDataStream(indexPath);
  if (signal.aborted) {
    input.destroy();
    throw new Error("Benchmark cancelled");
  }

  return new Promise((resolve, reject) => {
    const state = createFzfOutputState();
    const argv = ["--extended", "--read0", "--print0", "--filter", query];
    if (strategy.noSort) argv.push("--no-sort");
    const child = spawn("fzf", argv, { stdio: ["pipe", "pipe", "pipe"] });
    registerChild(child);

    let firstResultMs = null;
    let limited = false;
    let cancelled = false;
    let error = null;
    let stderrBytes = 0;
    let settled = false;
    let timeout;
    const stop = () => {
      input.destroy();
      child.stdin.destroy();
      terminateChild(child);
    };
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();

    timeout = setTimeout(() => {
      error ??= new Error("fzf strategy benchmark timed out");
      stop();
    }, 60_000);
    timeout.unref();

    const onFailure = (failure) => {
      if (!cancelled && !limited) error ??= failure;
      stop();
    };
    input.once("error", onFailure);
    child.stdin.on("error", (failure) => {
      if (!limited && !cancelled && failure.code !== "EPIPE") onFailure(failure);
    });
    child.stdout.on("data", (chunk) => {
      if (cancelled || limited) return;
      const before = state.results.length;
      appendFzfOutputChunk(state, chunk);
      if (firstResultMs === null && before === 0 && state.results.length) {
        firstResultMs = performance.now() - started;
      }
      if (state.limitReached) {
        limited = true;
        stop();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
    });
    child.once("error", onFailure);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      input.destroy();
      child.stdin.destroy();

      if (cancelled) reject(new Error("Benchmark cancelled"));
      else if (error) reject(error);
      else if (!limited && code !== 0 && !(code === 1 && stderrBytes === 0)) {
        reject(new Error("fzf filter exited with code " + String(code)));
      } else {
        resolve({
          elapsedMs: performance.now() - started,
          firstResultMs,
          results: state.results,
          limitReached: limited,
          exitCode: code,
        });
      }
    });

    if (!cancelled) input.pipe(child.stdin);
  });
}

function overlapPercent(reference, candidate) {
  if (!reference.length && !candidate.length) return 100;
  if (!reference.length) return 0;
  const other = new Set(candidate);
  return Number((100 * reference.filter((value) => other.has(value)).length / reference.length).toFixed(1));
}

/**
 * 所有模式共享一份索引和完全相同的查询。
 * 每个 (mode, query) 先预热一次，再按轮交错测量。
 */
export async function compareCpuSearchStrategies({
  indexPath,
  queries,
  runs,
  signal,
}) {
  const preloaded = await preloadPaths(indexPath, signal);
  const rows = [];
  for (const queryCase of queries) {
    for (const strategy of STRATEGIES) {
      rows.push({
        workload: queryCase.kind,
        strategy: strategy.id,
        query: queryCase.query,
        noSort: strategy.noSort,
        useMemory: strategy.useMemory,
        durations: [],
        firstDurations: [],
        resultCount: 0,
        hitLimit: false,
        finalResults: [],
      });
    }
  }

  for (let round = 0; round <= runs; round++) {
    for (const row of rows) {
      if (signal.aborted) throw new Error("Benchmark cancelled");
      const result = await measureFilter(
        indexPath,
        row.query,
        { noSort: row.noSort, useMemory: row.useMemory },
        preloaded.chunks,
        signal,
      );
      if (round > 0) {
        row.durations.push(result.elapsedMs);
        if (result.firstResultMs !== null) row.firstDurations.push(result.firstResultMs);
      }
      row.resultCount = result.results.length;
      row.hitLimit = result.limitReached;
      row.finalResults = result.results;
    }
  }

  const results = rows.map((row) => {
    const reference = rows.find((r) => r.workload === row.workload && r.strategy === "sorted-compressed");
    return {
      workload: row.workload,
      strategy: row.strategy,
      runs,
      ...summarize(row.durations),
      firstResultP50Ms: row.firstDurations.length ? summarize(row.firstDurations).p50Ms : null,
      count: row.resultCount,
      limitReached: row.hitLimit,
      resultOverlapWithSortedPercent: overlapPercent(reference.finalResults, row.finalResults),
    };
  });

  return {
    rawMemoryBytes: preloaded.bytes,
    resultLimit: MAX_FZF_RESULTS,
    warmupRounds: 1,
    measuredRounds: runs,
    strategies: results,
    peakNodeRssBytes: process.resourceUsage().maxRSS * 1024,
    notes: [
      "sorted-compressed reproduces the production fzf query flags on a v3 Brotli stream",
      "unsorted modes use fzf --no-sort; returned order and match quality may differ",
      "memory modes feed already-decoded paths from RAM; no plaintext index file is written",
      "firstResultP50Ms is null for no-match; output never includes search queries or paths",
      "all times are end-to-end wall times and include child spawn/close; Node CPU is not the whole-system CPU",
    ],
  };
}
