import { performance } from "node:perf_hooks";
import { stat } from "node:fs/promises";
import os from "node:os";
import { runFzfFilter } from "../src/lib/fzf-runner.ts";
import { readIndexHeader } from "../src/lib/index-files.ts";

function parseArgs(args) {
  const [indexPath, ...rest] = args;
  if (!indexPath)
    throw new Error(
      'Usage: npm run benchmark:path -- "/path/to/index.nul" "src" "src/lib" [--runs 5]',
    );
  const queries = [];
  let runs = 5;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--runs") {
      runs = Number(rest[++i]);
    } else if (rest[i].startsWith("--")) {
      throw new Error("Unknown benchmark option");
    } else {
      queries.push(rest[i]);
    }
  }
  if (
    queries.length < 1 ||
    queries.length > 8 ||
    queries.some((q) => !q.trim())
  )
    throw new Error("Pass between 1 and 8 non-empty search queries");
  if (!Number.isInteger(runs) || runs < 2 || runs > 20)
    throw new Error("--runs must be between 2 and 20");
  return { indexPath, queries, runs };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (percentile) =>
    sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
  return {
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: Number(at(0.5).toFixed(2)),
    p95Ms: Number(at(0.95).toFixed(2)),
    maxMs: Number(sorted.at(-1).toFixed(2)),
  };
}

async function benchmark() {
  const { indexPath, queries, runs } = parseArgs(process.argv.slice(2));
  const info = await stat(indexPath);
  if (!info.isFile()) throw new Error("Index path is not a regular file");
  const header = await readIndexHeader(indexPath);

  const results = queries.map((query, i) => ({
    label: "query_" + (i + 1),
    mode: query.includes("/") ? "path" : "basename",
    length: [...query].length,
    samples: [],
    resultCount: 0,
    limited: false,
    cpuUserMs: 0,
    cpuSystemMs: 0,
  }));

  // 预热一次。之后每轮更换查询起点，降低文件系统缓存顺序偏差。
  const rounds = runs + 1;
  let peakNodeRss = process.memoryUsage().rss;
  for (let round = 0; round < rounds; round++) {
    for (let j = 0; j < queries.length; j++) {
      const i = (round + j) % queries.length;
      const start = performance.now();
      const cpuStart = process.cpuUsage();
      const result = await runFzfFilter("fzf", indexPath, queries[i]);
      const elapsed = performance.now() - start;
      const cpu = process.cpuUsage(cpuStart);
      peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss);

      if (result.cancelled) throw new Error("Unexpected search cancellation");
      const entry = results[i];
      entry.resultCount = result.paths.length;
      entry.limited = result.limited;
      if (round > 0) {
        entry.samples.push(elapsed);
        entry.cpuUserMs += cpu.user / 1000;
        entry.cpuSystemMs += cpu.system / 1000;
      }
    }
  }

  const output = {
    benchmark: "pathseek-real-index-search-v1",
    platform: process.platform,
    node: process.version,
    arch: os.arch(),
    indexVersion: header.version,
    indexedPaths: header.count,
    compressedIndexBytes: info.size,
    rounds: runs,
    warmups: 1,
    peakNodeRssBytes: peakNodeRss,
    queries: results.map((item) => ({
      label: item.label,
      mode: item.mode,
      queryCharacters: item.length,
      ...stats(item.samples),
      averageNodeUserCpuMs: Number((item.cpuUserMs / runs).toFixed(2)),
      averageNodeSystemCpuMs: Number((item.cpuSystemMs / runs).toFixed(2)),
      results: item.resultCount,
      limited: item.limited,
    })),
    note: "Read-only benchmark. Query text, indexed paths and filenames are excluded from output. CPU and RSS cover Node.js only, not the fzf child or Raycast.",
  };
  console.log(JSON.stringify(output, null, 2));
}

try {
  await benchmark();
} catch (error) {
  console.error(
    "Path search benchmark failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}
