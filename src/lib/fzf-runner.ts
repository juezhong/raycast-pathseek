import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { openIndexDataStream } from "./index-files.ts";
import { parseFuzzyPathQuery } from "./fuzzy-path-query.ts";
import { appendFzfOutputChunk, createFzfOutputState } from "./fzf-output.ts";
import {
  appendPinyinPriorityChunk,
  createPinyinPriorityOutput,
  finishPinyinPriorityOutput,
} from "./fzf-pinyin-priority.ts";
import {
  createPinyinFilterInput,
  originalPathFromPinyinResult,
  shouldUsePinyinAliases,
} from "./pinyin-filter.ts";
import {
  cancelledError,
  registerChild,
  terminateChild,
  throwIfAborted,
} from "./managed-child.ts";

export type FilterResult = {
  paths: string[];
  exitCode: number | null;
  limited: boolean;
  cancelled: boolean;
};

/** 完整等待 fzf close，解压输入、stdout、stderr 和 stdin 均随查询结束清理。 */
export async function runFzfFilter(
  binary: string,
  indexPath: string,
  query: string,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<FilterResult> {
  throwIfAborted(signal);
  const pathQuery = parseFuzzyPathQuery(query);
  const nameQuery = pathQuery?.nameQuery ?? query;
  const input = await openIndexDataStream(indexPath);
  const pinyinMode = shouldUsePinyinAliases(nameQuery);
  const augmented = createPinyinFilterInput(
    pinyinMode,
    pathQuery?.directoryPatterns ?? [],
  );
  const source = augmented;
  if (signal?.aborted) {
    input.destroy();
    augmented.destroy();
    throw cancelledError();
  }

  return new Promise<FilterResult>((resolve, reject) => {
    const output = createFzfOutputState();
    const pinyinOutput = pinyinMode ? createPinyinPriorityOutput() : undefined;
    let limited = false;
    let cancelled = false;
    let fatal: Error | undefined;
    let stderr = "";
    let finished = false;
    let stopping = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    let child;
    try {
      child = spawn(
        binary,
        [
          "--extended",
          "--read0",
          "--print0",
          "--delimiter",
          "\t",
          "--nth",
          "1",
          "--filter",
          nameQuery,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (error) {
      input.destroy();
      augmented.destroy();
      reject(error);
      return;
    }
    registerChild(child);

    // 等待解压管道关闭后再结束 Promise，避免遗留文件描述符。
    const waitForClose = (stream: Readable) =>
      new Promise<void>((resolve) => {
        if (stream.closed) resolve();
        else stream.once("close", () => resolve());
      });
    const inputClosed = Promise.all([
      waitForClose(input),
      waitForClose(augmented),
    ]);

    const stop = () => {
      if (stopping) return;
      stopping = true;
      input.unpipe();
      source.unpipe(child.stdin);
      source.destroy();
      input.destroy();
      child.stdin.destroy();
      terminateChild(child);
    };

    const onAbort = () => {
      cancelled = true;
      stop();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();
    }

    if (timeoutMs > 0) {
      deadline = setTimeout(() => {
        fatal = new Error("fzf search exceeded the time limit");
        stop();
      }, timeoutMs);
      deadline.unref();
    }

    const fail = (error: Error) => {
      if (!cancelled && !limited) fatal ??= error;
      stop();
    };

    input.once("error", fail);
    augmented.once("error", fail);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (!cancelled && !limited && error.code !== "EPIPE") fail(error);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (limited || cancelled) return;
      try {
        if (pinyinOutput) appendPinyinPriorityChunk(pinyinOutput, chunk);
        else appendFzfOutputChunk(output, chunk);
        if (pinyinOutput?.limitReached || output.limitReached) {
          limited = true;
          stop();
        }
      } catch (error) {
        fail(error as Error);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096)
        stderr += chunk.toString("utf8").slice(0, 4096 - stderr.length);
    });

    child.once("error", (error: Error) => {
      if (!cancelled) fatal ??= error;
      stop();
    });
    child.once("close", (code) => {
      if (finished) return;
      finished = true;
      if (deadline) clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      input.destroy();
      augmented.destroy();
      child.stdin.destroy();

      void inputClosed.then(() => {
        if (cancelled) {
          resolve({
            paths: [],
            exitCode: code,
            limited: false,
            cancelled: true,
          });
        } else if (fatal) {
          reject(fatal);
        } else if (limited || code === 0 || (code === 1 && !stderr)) {
          try {
            const rawResults = pinyinOutput
              ? finishPinyinPriorityOutput(pinyinOutput)
              : output.results;
            const paths = rawResults.map(originalPathFromPinyinResult);
            resolve({ paths, exitCode: code, limited, cancelled: false });
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`fzf failed (exit ${code}): ${stderr.trim()}`));
        }
      });
    });

    if (!cancelled && !stopping) {
      input.pipe(augmented).pipe(child.stdin);
    }
  });
}
