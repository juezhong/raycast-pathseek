import type { ChildProcess } from "node:child_process";

/**
 * 在进程正常退出时尝试终止由扩展启动的 fd/fzf。
 * SIGKILL、系统崩溃等不可捕获终止无法由 JavaScript 保证清理。
 */
const children = new Set<ChildProcess>();
const exited = new WeakSet<ChildProcess>();
process.once("exit", () => {
  for (const child of children) {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    } catch {
      // 进程退出回调只能执行同步清理，不能抛出异常。
    }
  }
});

export function registerChild(child: ChildProcess): void {
  children.add(child);
  child.once("exit", () => exited.add(child));
  child.once("close", () => { exited.add(child); children.delete(child); });
}

/** 请求退出，并在宽限期后升级到 SIGKILL；定时器不会阻止 Node 退出。 */
export function terminateChild(
  child: ChildProcess,
  graceMs = 1500,
): void {
  if (exited.has(child)) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // 子进程可能恰好已经退出。
  }

  const timer = setTimeout(() => {
    if (exited.has(child)) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // 进程已经退出。
    }
  }, graceMs);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
}

export function cancelledError(): Error {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}
