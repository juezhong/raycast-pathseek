import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { openIndexDataStream, readIndexHeader } from "../src/lib/index-files.ts";
import {
  MAX_FZF_RESULTS,
  appendFzfOutputChunk,
  createFzfOutputState,
} from "../src/lib/fzf-output.ts";

const [indexPath, ...queries] = process.argv.slice(2);

async function measureSearch(index, query) {
  const start = performance.now();
  const input = await openIndexDataStream(index);
  const child = spawn(
    "fzf",
    ["--extended", "--read0", "--print0", "--filter", query],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const output = createFzfOutputState();
  let failed = false;
  let limited = false;
  let stderrBytes = 0;

  const result = await new Promise((resolve, reject) => {
    let settled = false;
    function done(error, exitCode) {
      if (settled) return;
      settled = true;
      input.destroy();
      if (error) reject(error);
      else {
        resolve({
          queryLength: Buffer.byteLength(query, "utf8"),
          elapsedMs: Number((performance.now() - start).toFixed(1)),
          resultCount: output.results.length,
          limitReached: limited,
          exitCode,
        });
      }
    }
    input.once("error", (error) => {
      failed = true;
      child.kill();
      done(error);
    });
    child.stdin.on("error", (error) => {
      if (!limited && error.code !== "EPIPE") {
        failed = true;
        child.kill();
        done(error);
      }
    });
    child.stdout.on("data", (chunk) => {
      if (limited) return;
      appendFzfOutputChunk(output, chunk);
      if (output.limitReached) {
        limited = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
    });
    child.once("error", (error) => {
      failed = true;
      done(error);
    });
    child.once("close", (code) => {
      if (!failed && (limited || code === 0 || (code === 1 && stderrBytes === 0)))
        done(undefined, code);
      else
        done(new Error("fzf failed with exit code " + code));
    });
    input.pipe(child.stdin);
  });

  return result;
}

if (!indexPath || queries.length === 0 || queries.length > 8 || queries.some((q) => !q.trim())) {
  console.error('Usage: npm run benchmark:search -- "/absolute/path/to/index.nul" "kernel" "drivers" [more queries]');
  process.exitCode = 2;
} else {
  try {
    const header = await readIndexHeader(indexPath);
    const bytes = (await stat(indexPath)).size;
    const measurements = [];
    for (const query of queries) {
      measurements.push(await measureSearch(indexPath, query));
    }
    const times = measurements.map((m) => m.elapsedMs).sort((a, b) => a - b);
    const median = times[Math.floor((times.length - 1) / 2)];

    console.log(JSON.stringify({
      indexVersion: header.version,
      indexedPaths: header.count,
      indexBytes: bytes,
      resultLimit: MAX_FZF_RESULTS,
      medianSearchMs: median,
      measurements,
      note: "Query text, filenames and absolute paths are deliberately omitted.",
    }, null, 2));
  } catch (error) {
    console.error("Search benchmark failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
