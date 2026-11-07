import { beginCommandTrace } from "./command-trace";
import { runFzfFilter } from "./fzf-runner";
import {
  findBinary,
  getPreferences,
  indexFilePath,
  type IndexMetadata,
} from "./index-store";

/** 只搜索现有索引；每次查询独立创建并在返回前清理 fzf 子进程。 */
export async function fuzzySearch(
  index: IndexMetadata,
  query: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!query.trim() || signal?.aborted) return [];

  const binary = await findBinary("fzf", getPreferences().fzfBinary);
  if (signal?.aborted) return [];

  const trace = await beginCommandTrace(
    "fzf",
    "fuzzy-query",
    "fzf --extended --read0 --print0 --filter <redacted>",
  );

  try {
    const result = await runFzfFilter(
      binary,
      indexFilePath(index),
      query,
      signal,
    );
    await trace?.finish(
      result.cancelled
        ? "cancelled"
        : result.limited
          ? "limit-reached"
          : "success",
      result.paths.length,
      result.exitCode,
    );
    return result.paths;
  } catch (error) {
    await trace?.finish(
      signal?.aborted ? "cancelled" : "failure",
      undefined,
      undefined,
      error,
    );
    if (signal?.aborted) return [];
    throw error;
  }
}
