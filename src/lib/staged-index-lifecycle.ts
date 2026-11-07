import { rmSync } from "node:fs";
import path from "node:path";

/**
 * 仅登记本次构建产生的暂存索引，不接触已发布的 index.nul。
 * UI 正常取消由异步 finally 清理；进程可捕获的退出作为最后一道兜底。
 * SIGKILL、系统断电或 Raycast 强杀 worker 无法保证执行退出钩子。
 */
const stages = new Set<string>();
const STAGED_INDEX_NAME =
  /^index-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.nul\.tmp$/i;

process.once("exit", () => {
  for (const filename of stages) {
    try {
      rmSync(filename, { force: true });
    } catch {
      // 进程退出阶段不能执行异步操作；下一次持有构建锁时会回收遗留文件。
    }
  }
});

export function trackStagedIndex(filename: string): () => void {
  if (!path.isAbsolute(filename) || !STAGED_INDEX_NAME.test(path.basename(filename))) {
    throw new Error("Invalid PathSeek staged index path");
  }
  stages.add(filename);
  return () => stages.delete(filename);
}
