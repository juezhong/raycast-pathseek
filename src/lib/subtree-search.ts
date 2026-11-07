import path from "node:path";
import { MAX_FZF_PATH_BYTES } from "./fzf-output.ts";
import { compileFuzzyParentPathMatcher } from "./fuzzy-path-query.ts";
import { openIndexDataStream } from "./index-files.ts";
import { throwIfAborted } from "./managed-child.ts";
import { pinyinAlias } from "./pinyin-filter.ts";

const MAX_DIRECTORY_CHOICES = 50;
const MAX_CHECKED_DIRECTORIES = 8192;

export type SubtreeQuery = {
  directoryPatterns: string[];
  directoryExpression: string;
  nameQuery: string;
  marker: "/ " | "//";
};

export type DirectoryChoices = {
  paths: string[];
  truncated: boolean;
};

/**
 * 只有 "/ " 或 "//" 才进入子树模式。保留原有单斜杠连续层级查询。
 * 解析时不依赖输入末尾的 trim()，否则会丢失用于切换模式的空格。
 */
export function parseSubtreeQuery(input: string): SubtreeQuery | null {
  const match = /^(.*?)\/(\/| )([\s\S]*)$/u.exec(input);
  if (!match) return null;

  const directoryExpression = match[1].trim();
  if (!directoryExpression) {
    throw new Error("Subtree search needs a directory before /  or //");
  }
  const directoryPatterns = directoryExpression.split("/").map((s) => s.trim());
  if (
    directoryPatterns.length > 16 ||
    directoryPatterns.some((s) => !s || s.length > 128)
  ) {
    throw new Error("Subtree directory query needs 1 to 16 non-empty levels (max 128 characters each)");
  }
  const nameQuery = match[3].trimStart();
  if (nameQuery.startsWith("/"))
    throw new Error("Subtree search cannot start with an empty directory level (///)");
  if (nameQuery.length > 512) throw new Error("Subtree filename query is too long");

  return {
    directoryPatterns,
    directoryExpression,
    nameQuery,
    marker: match[2] === "/" ? "//" : "/ ",
  };
}

/** 前缀边界必须完整：/foo 不能命中 /foobar。 */
export function isPathInsideDirectory(filepath: string, directory: string): boolean {
  const normalized = directory === "/" ? "/" : directory.replace(/\/+$/u, "");
  const prefix = normalized === "/" ? "/" : normalized + "/";
  return filepath.startsWith(prefix) && filepath.length > prefix.length;
}

/**
 * 支持一个目录被高亮后才输入分隔符。
 * 高亮目录可以是表达式本身匹配的目录，也可以是它的直接子目录。
 */
export function matchesSelectedDirectory(
  filepath: string,
  directoryPatterns: readonly string[],
): boolean {
  const normalized = filepath.replace(/\/+$/u, "");
  if (!normalized.startsWith("/")) return false;
  const matches = compileFuzzyParentPathMatcher(directoryPatterns, pinyinAlias);
  return matches(normalized + "/__pathseek_probe__") || matches(normalized);
}

/**
 * 只读取既有索引，目录由实际索引记录的父路径推断；
 * 不调用 fd，不在内存中构建整个目录树，不跟随磁盘软链接。
 * 即使展示超过 50 个目录，也不会凭列表上限误判为唯一。
 */
export async function findIndexedDirectoryChoices(
  indexPath: string,
  directoryPatterns: readonly string[],
  signal?: AbortSignal,
  maxChoices = MAX_DIRECTORY_CHOICES,
): Promise<DirectoryChoices> {
  if (maxChoices < 1) throw new Error("Directory choice limit must be positive");
  throwIfAborted(signal);
  const match = compileFuzzyParentPathMatcher(directoryPatterns, pinyinAlias);
  const found = new Set<string>();
  const checked = new Set<string>();
  let pending = Buffer.alloc(0);
  const stream = await openIndexDataStream(indexPath);
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      let offset = 0;
      while (offset < chunk.length) {
        const end = chunk.indexOf(0, offset);
        if (end < 0) {
          const tail = chunk.subarray(offset);
          if (pending.length + tail.length > MAX_FZF_PATH_BYTES)
            throw new Error("Index path exceeds size limit");
          pending = pending.length ? Buffer.concat([pending, tail]) : Buffer.from(tail);
          break;
        }
        const part = chunk.subarray(offset, end);
        if (pending.length + part.length > MAX_FZF_PATH_BYTES)
          throw new Error("Index path exceeds size limit");
        const record = pending.length
          ? Buffer.concat([pending, part]).toString("utf8")
          : part.toString("utf8");
        pending = Buffer.alloc(0);
        offset = end + 1;

        const normalized = record.endsWith("/") ? record.replace(/\/+$/u, "") : record;
        let directory = record.endsWith("/") ? normalized : path.dirname(normalized);
        while (directory && directory !== "/" && directory !== ".") {
          if (checked.has(directory)) break;
          checked.add(directory);
          if (checked.size > MAX_CHECKED_DIRECTORIES) {
            const oldest = checked.values().next().value;
            if (oldest) checked.delete(oldest);
          }
          if (match(directory + "/__pathseek_probe__")) {
            found.add(directory);
            if (found.size > maxChoices) {
              return { paths: [...found].slice(0, maxChoices), truncated: true };
            }
          }
          const parent = path.dirname(directory);
          if (parent === directory) break;
          directory = parent;
        }
      }
    }
    if (pending.length) throw new Error("Incomplete NUL-delimited index input");
    return { paths: [...found].sort(), truncated: false };
  } finally {
    stream.destroy();
  }
}
