import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { findBinary, getPreferences, indexFilePath, type IndexMetadata } from "./index-store";

const MAX_RESULTS = 150;

/**
 * 仅搜索已经持久化的索引；此函数不会运行 fd 或遍历目录树。
 */
export async function fuzzySearch(
  index: IndexMetadata,
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!query.trim()) return [];
  if (signal?.aborted) return [];

  const binary = await findBinary("fzf", getPreferences().fzfBinary);
  const input = createReadStream(indexFilePath(index));

  return await new Promise<string[]>((resolve, reject) => {
    const results: string[] = [];
    let pending = Buffer.alloc(0);
    let limited = false;
    let stderr = "";
    let finished = false;

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      input.destroy();
      if (error) reject(error);
      else resolve(results);
    };

    const child = spawn(binary, ["--read0", "--print0", "--filter", query], {
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });

    input.on("error", (error) => {
      child.kill();
      finish(error);
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      // 到达结果上限并结束 fzf 时，输入流可能出现预期的 EPIPE。
      if (error.code !== "EPIPE" && !limited && !signal?.aborted) finish(error);
    });
    input.pipe(child.stdin);

    child.stdout.on("data", (data: Buffer) => {
      pending = Buffer.concat([pending, data]);
      while (true) {
        const boundary = pending.indexOf(0);
        if (boundary < 0) break;
        const filename = pending.subarray(0, boundary).toString("utf8");
        pending = pending.subarray(boundary + 1);
        if (filename) results.push(filename);
        if (results.length >= MAX_RESULTS) {
          limited = true;
          child.kill();
          break;
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length < 4096) stderr += data.toString("utf8");
    });

    child.once("error", (error) => {
      if (signal?.aborted) finish();
      else finish(error);
    });

    child.once("close", (code) => {
      if (signal?.aborted || limited || code === 0 || (code === 1 && !stderr)) {
        finish();
      } else {
        finish(new Error(`fzf failed (exit ${code}): ${stderr.trim()}`));
      }
    });
  });
}
