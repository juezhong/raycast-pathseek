import { spawn } from "node:child_process";
import { openIndexDataStream } from "./index-files.ts";
import { appendFzfOutputChunk, createFzfOutputState } from "./fzf-output.ts";
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
  const input = await openIndexDataStream(indexPath);
  if (signal?.aborted) {
    input.destroy();
    throw cancelledError();
  }

  return new Promise<FilterResult>((resolve, reject) => {
    const output = createFzfOutputState();
    let limited = false;
    let cancelled = false;
    let fatal: Error | undefined;
    let stderr = "";
    let finished = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    let child;
    try {
      child = spawn(
        binary,
        ["--extended", "--read0", "--print0", "--filter", query],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (error) {
      input.destroy();
      reject(error);
      return;
    }
    registerChild(child);

    const stop = () => {
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
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (!cancelled && !limited && error.code !== "EPIPE") fail(error);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (limited || cancelled) return;
      appendFzfOutputChunk(output, chunk);
      if (output.limitReached) {
        limited = true;
        stop();
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
      child.stdin.destroy();

      if (cancelled) {
        resolve({ paths: [], exitCode: code, limited: false, cancelled: true });
      } else if (fatal) {
        reject(fatal);
      } else if (limited || code === 0 || (code === 1 && !stderr)) {
        resolve({
          paths: output.results,
          exitCode: code,
          limited,
          cancelled: false,
        });
      } else {
        reject(new Error(`fzf failed (exit ${code}): ${stderr.trim()}`));
      }
    });

    if (!cancelled) input.pipe(child.stdin);
  });
}
