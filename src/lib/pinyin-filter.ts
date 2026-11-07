import path from "node:path";
import { Transform } from "node:stream";
import { pinyin } from "pinyin-pro";
import { MAX_FZF_PATH_BYTES } from "./fzf-output.ts";

const HAN_TEXT = /\p{Script=Han}+/gu;
const NUL = Buffer.from([0]);
const TAB = Buffer.from("\t");
const MAX_ALIAS_CHARS = 2048;

/**
 * 带 fzf 操作符的表达式只在真实名称上匹配，不转写查询。
 * 数字和拉丁字母混合查询（例如 2026 dyc）允许启用拼音别名。
 */
export function shouldUsePinyinAliases(query: string): boolean {
  const normalized = query.trim();
  return (
    normalized.length > 0 &&
    normalized.length <= 80 &&
    /[a-z]/i.test(normalized) &&
    /^[a-z0-9]+(?:\s+[a-z0-9]+)*$/i.test(normalized)
  );
}

/** 只转换该条索引记录自身的文件/目录名称，不能从父目录获取拼音匹配。 */
export function pinyinAlias(filename: string): string {
  const words = filename.match(HAN_TEXT);
  if (!words) return "";
  const syllables = words.flatMap((word) =>
    pinyin(word, { type: "array", toneType: "none", nonZh: "removed" }),
  );
  const initials = syllables.map((syllable) => syllable[0] ?? "").join("");
  const full = syllables.join("");
  if (!initials || !full) return "";
  return [initials, full, initials.toUpperCase(), full.toUpperCase()]
    .join(" ")
    .slice(0, MAX_ALIAS_CHARS);
}

/**
 * 每条索引路径转换为:
 *   <当前名称 + 可选拼音别名><TAB><完整原始路径><NUL>
 *
 * fzf 使用 --delimiter=TAB --nth=1 仅匹配第一字段；
 * 筛选完成后还原 TAB 后面的真实路径供打开/粘贴。
 * TAB 在名称的搜索字段中替换为空格，原始路径字节完全保留。
 * 全程流式处理，不落盘、不创建第二份索引或后台缓存。
 */
export function createPinyinFilterInput(enablePinyin = true): Transform {
  let pending = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        let offset = 0;
        while (offset < chunk.length) {
          const end = chunk.indexOf(0, offset);
          const section = chunk.subarray(offset, end === -1 ? undefined : end);
          if (pending.length + section.length > MAX_FZF_PATH_BYTES)
            throw new Error("Index path exceeds size limit");
          if (end === -1) {
            pending = pending.length
              ? Buffer.concat([pending, section])
              : Buffer.from(section);
            break;
          }
          const record = pending.length
            ? Buffer.concat([pending, section])
            : section;
          pending = Buffer.alloc(0);

          const filepath = record.toString("utf8");
          const filename = path.basename(filepath);
          // fzf 字段分隔符不能成为可搜索文件名的一部分。
          const label = filename.replaceAll("\t", " ");
          const alias = enablePinyin ? pinyinAlias(filename) : "";
          const matchField = Buffer.from(
            alias ? label + " " + alias : label,
            "utf8",
          );
          if (matchField.length + TAB.length + record.length > MAX_FZF_PATH_BYTES)
            throw new Error("Search record exceeds size limit");
          this.push(Buffer.concat([matchField, TAB, record, NUL]));
          offset = end + 1;
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      callback(
        pending.length
          ? new Error("Incomplete NUL-delimited index input")
          : undefined,
      );
    },
  });
}

export function originalPathFromPinyinResult(value: string): string {
  const separator = value.indexOf("\t");
  if (separator === -1)
    throw new Error("Malformed filename-matched fzf output");
  return value.slice(separator + 1);
}
