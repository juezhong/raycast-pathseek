import type { ChildProcess } from "node:child_process";

/**
 * 只跟踪尚未 close 的子进程；没有常驻 worker 或周期轮询。
 * 当 Node 正常退出时，同步终止残留 fd/fzf；SIGKILL 无法拦截。
 */
const children = new Set<ChildProcess>();
const exited = new WeakSet<ChildProcess>();
const terminationTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();

function clearTermination(child: ChildProcess): void {
  const timer = terminationTimers.get(child);
  if (!timer) return;
  clearTimeout(timer);
  terminationTimers.delete(child);
}

process.once("exit", () => {
  for (const child of children) {
    try {
      if (!exited.has(child)) child.kill("SIGKILL");
    } catch {
      // 退出钩子只能执行同步清理。
    }
  }
});

export function registerChild(child: ChildProcess): void {
  children.add(child);
  child.once("exit", () => {
    exited.add(child);
    clearTermination(child);
  });
  child.once("close", () => {
    exited.add(child);
    clearTermination(child);
    children.delete(child);
  });
}

/**
 * 终止必须幂等；同一子进程可能同时被取消、管道错误或输出上限触发。
 * 不得叠加多个 SIGKILL 定时器与 close 监听器。
 */
export function terminateChild(child: ChildProcess, graceMs = 1500): void {
  if (exited.has(child) || terminationTimers.has(child)) return;

  const timer = setTimeout(() => {
    terminationTimers.delete(child);
    if (exited.has(child)) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // 进程可能已经退出。
    }
  }, graceMs);
  timer.unref();
  terminationTimers.set(child, timer);

  try {
    child.kill("SIGTERM");
  } catch {
    // spawn 失败或进程已经退出，由 close/exit 完成最终清理。
  }
}

export function cancelledError(): Error {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}
