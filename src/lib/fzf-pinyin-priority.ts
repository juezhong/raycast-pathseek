import path from "node:path";
import {
  MAX_FZF_PATH_BYTES,
  MAX_FZF_RESULTS,
  MAX_FZF_TOTAL_BYTES,
} from "./fzf-output.ts";

// 为真实中文名称保留一部分结果名额，避免被短英文名称挤出前 150 名。
// 限制最多读取的 fzf 输出条数，防止宽泛查询造成无界的 stdout 处理。
export const PINYIN_RESERVED_RESULTS = 30;
export const MAX_PINYIN_OUTPUT_SCAN = 10_000;

export type PinyinPriorityOutput = {
  pending: Buffer;
  primary: string[];
  fallback: string[];
  chinese: string[];
  totalBytes: number;
  scanned: number;
  limitReached: boolean;
};

export function createPinyinPriorityOutput(): PinyinPriorityOutput {
  return {
    pending: Buffer.alloc(0),
    primary: [],
    fallback: [],
    chinese: [],
    totalBytes: 0,
    scanned: 0,
    limitReached: false,
  };
}

function hasChineseBasename(record: string): boolean {
  const delimiter = record.indexOf("\t");
  if (delimiter === -1) return false;
  return /\p{Script=Han}/u.test(path.basename(record.slice(delimiter + 1)));
}

function add(state: PinyinPriorityOutput, target: string[], record: string) {
  const bytes = Buffer.byteLength(record, "utf8");
  if (state.totalBytes + bytes > MAX_FZF_TOTAL_BYTES)
    throw new Error("fzf results exceed memory size limit");
  state.totalBytes += bytes;
  target.push(record);
}

/**
 * fzf 默认为按相关度排序的 --filter 输出。
 * 保存前 120 条普通结果、后续最多 30 条作为回退，同时从整个有界输出中
 * 抽取最多 30 条中文名称。最后将中文名称补入 150 条结果。
 * 仅针对普通拼音查询，不改变 fzf 的原始匹配算法或特殊操作符。
 */
export function appendPinyinPriorityChunk(
  state: PinyinPriorityOutput,
  chunk: Buffer,
): void {
  if (state.limitReached || !chunk.length) return;
  const data = state.pending.length
    ? Buffer.concat([state.pending, chunk])
    : chunk;
  let offset = 0;
  const plainLimit = MAX_FZF_RESULTS - PINYIN_RESERVED_RESULTS;

  while (offset < data.length) {
    const boundary = data.indexOf(0, offset);
    if (boundary === -1) break;
    if (boundary - offset > MAX_FZF_PATH_BYTES)
      throw new Error("fzf output path exceeds size limit");
    const bytes = data.subarray(offset, boundary);
    offset = boundary + 1;
    if (!bytes.length) continue;

    state.scanned++;
    const shouldRetain =
      state.primary.length < plainLimit ||
      state.fallback.length < PINYIN_RESERVED_RESULTS ||
      state.chinese.length < PINYIN_RESERVED_RESULTS;
    if (shouldRetain) {
      const value = bytes.toString("utf8");
      if (state.primary.length < plainLimit) add(state, state.primary, value);
      else {
        if (state.fallback.length < PINYIN_RESERVED_RESULTS)
          add(state, state.fallback, value);
        if (
          state.chinese.length < PINYIN_RESERVED_RESULTS &&
          hasChineseBasename(value)
        )
          add(state, state.chinese, value);
      }
    }

    if (
      state.scanned >= MAX_PINYIN_OUTPUT_SCAN ||
      (state.primary.length >= plainLimit &&
        state.chinese.length >= PINYIN_RESERVED_RESULTS)
    ) {
      state.limitReached = true;
      state.pending = Buffer.alloc(0);
      return;
    }
  }

  if (data.length - offset > MAX_FZF_PATH_BYTES)
    throw new Error("fzf output path exceeds size limit");
  state.pending = Buffer.from(data.subarray(offset));
}

export function finishPinyinPriorityOutput(state: PinyinPriorityOutput): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const record of [...state.primary, ...state.chinese, ...state.fallback]) {
    if (seen.has(record)) continue;
    seen.add(record);
    results.push(record);
    if (results.length >= MAX_FZF_RESULTS) break;
  }
  return results;
}
