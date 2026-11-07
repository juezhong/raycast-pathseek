import path from "node:path";
import { Transform } from "node:stream";
import { pinyin } from "pinyin-pro";
import { MAX_FZF_PATH_BYTES } from "./fzf-output.ts";
import {
  compileFuzzyParentPathMatcher,
  compileFuzzyTargetNameMatcher,
} from "./fuzzy-path-query.ts";

const HAN_TEXT = /\p{Script=Han}+/gu;
const NUL = Buffer.from([0]);
const TAB = Buffer.from("\t");
const MAX_ALIAS_CHARS = 2048;

/**
 * 只决定中文名称的保留配额，不影响拼音是否参与匹配。
 * 所有查询始终包含中文名称的拼音别名。
 */
export function shouldPrioritizePinyinResults(query: string): boolean {
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
export function createPinyinFilterInput(
  enablePinyin = true,
  directoryPatterns: readonly string[] = [],
  nativePathNameQuery?: string,
): Transform {
  let pending = Buffer.alloc(0);
  // 同一个父目录会被大量文件复用，限制为 2048 项的单次搜索缓存。
  const aliasCache = new Map<string, string>();
  const hanText = /\p{Script=Han}/u;
  const directoryAlias = (name: string): string => {
    if (!enablePinyin || !hanText.test(name)) return "";
    const cached = aliasCache.get(name);
    if (cached !== undefined) return cached;
    const alias = pinyinAlias(name);
    if (aliasCache.size >= 2048) {
      const oldest = aliasCache.keys().next().value;
      if (oldest !== undefined) aliasCache.delete(oldest);
    }
    aliasCache.set(name, alias);
    return alias;
  };
  // 不带 '/' 的普通搜索保持原样；目录表达式只编译一次。
  const matchesParent = directoryPatterns.length
    ? compileFuzzyParentPathMatcher(directoryPatterns, directoryAlias)
    : undefined;
  const matchesName = nativePathNameQuery
    ? compileFuzzyTargetNameMatcher(nativePathNameQuery, pinyinAlias)
    : undefined;
  const segmentQueries =
    nativePathNameQuery !== undefined
      ? [...directoryPatterns, nativePathNameQuery]
      : undefined;

  const projectPath = (filepath: string, filename: string): string => {
    if (!segmentQueries) {
      const label = filename.replaceAll("\t", " ");
      const alias = enablePinyin ? pinyinAlias(filename) : "";
      return alias ? label + " " + alias : label;
    }

    // 只投影需要的连续末尾层级，其他祖先不参与搜索。
    const segments = [filename];
    let end = filepath.lastIndexOf("/");
    for (let index = 0; index < directoryPatterns.length; index++) {
      const begin = filepath.lastIndexOf("/", end - 1);
      segments.push(filepath.slice(begin + 1, end));
      end = begin;
    }
    segments.reverse();

    return segments
      .map((segment, index) => {
        const label = segment.replaceAll("\t", " ");
        const alias =
          index === segments.length - 1
            ? enablePinyin ? pinyinAlias(segment) : ""
            : directoryAlias(segment);
        const field = alias ? label + " " + alias : label;
        // 包含大写的段严格匹配，其他段预先折叠大小写。
        return segmentQueries[index] === segmentQueries[index].toLowerCase()
          ? field.toLowerCase()
          : field;
      })
      .join("/");
  };

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
          if (matchesParent && !matchesParent(filepath)) {
            offset = end + 1;
            continue;
          }
          const filename = path.basename(filepath);
          if (matchesName && !matchesName(filename)) {
            offset = end + 1;
            continue;
          }
          const matchField = Buffer.from(projectPath(filepath, filename), "utf8");
          if (
            matchField.length + TAB.length + record.length >
            MAX_FZF_PATH_BYTES
          )
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
