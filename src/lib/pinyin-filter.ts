import path from "node:path";
import { performance } from "node:perf_hooks";
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
const FZF_INPUT_BATCH_BYTES = 64 * 1024;

export type PinyinInputDiagnostics = {
  inputRecords: number;
  outputRecords: number;
  outputBytes: number;
  outputChunks: number;
  transformMs: number;
};

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
  filenameQuery = "",
  diagnostics?: PinyinInputDiagnostics,
  scopeDirectory?: string,
): Transform {
  let pending = Buffer.alloc(0);
  // 文件名前的完整目录前缀，避免将 /foo 与 /foobar 混淆。
  const scopeBytes = scopeDirectory
    ? Buffer.from(
        scopeDirectory === "/"
          ? "/"
          : scopeDirectory.replace(/\/+$/u, "") + "/",
        "utf8",
      )
    : undefined;
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
  const anchoredQuery = /[\^$]/u.test(filenameQuery);
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
            ? enablePinyin
              ? pinyinAlias(segment)
              : ""
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
      const started = diagnostics ? performance.now() : 0;
      try {
        // 在单个输入块内合并完整记录，减少 Buffer.concat 和 stream.push 次数。
        // 每次转换结束即提交，避免跨块积累真实路径或额外常驻索引。
        const parts: Buffer[] = [];
        let batchBytes = 0;
        const flushBatch = () => {
          if (!batchBytes) return;
          this.push(Buffer.concat(parts, batchBytes));
          if (diagnostics) diagnostics.outputChunks++;
          parts.length = 0;
          batchBytes = 0;
        };
        const emitRecord = (field: Buffer, record: Buffer) => {
          const recordBytes = field.length + TAB.length + record.length;
          if (recordBytes > MAX_FZF_PATH_BYTES)
            throw new Error("Search record exceeds size limit");
          parts.push(field, TAB, record, NUL);
          batchBytes += recordBytes + NUL.length;
          if (diagnostics) {
            diagnostics.outputRecords++;
            diagnostics.outputBytes += recordBytes + NUL.length;
          }
          if (batchBytes >= FZF_INPUT_BATCH_BYTES) flushBatch();
        };
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
          if (diagnostics) diagnostics.inputRecords++;

          if (
            scopeBytes &&
            (record.length <= scopeBytes.length ||
              !record.subarray(0, scopeBytes.length).equals(scopeBytes))
          ) {
            offset = end + 1;
            continue;
          }

          if (!matchesParent && !matchesName && !segmentQueries) {
            // 普通无路径查询最常见：仅英文文件名直接复用索引字节。
            // 跳过 UTF-8 解码、path.basename、拼音正则和字段重新编码；
            // 中文/其他非 ASCII 名称以及 TAB 仍走原有兼容路径。
            let nameEnd = record.length;
            while (nameEnd > 1 && record[nameEnd - 1] === 47) nameEnd--;
            const separator = record.lastIndexOf(47, nameEnd - 1);
            const nameBytes = record.subarray(separator + 1, nameEnd);
            let simpleAscii = nameBytes.length > 0;
            for (let i = 0; simpleAscii && i < nameBytes.length; i++) {
              const byte = nameBytes[i];
              if (byte === 9 || byte > 127) simpleAscii = false;
            }
            if (simpleAscii) {
              emitRecord(nameBytes, record);
              offset = end + 1;
              continue;
            }
          }

          const filepath = record.toString("utf8");
          // 仅归一化用于匹配的路径；始终输出记录原始路径字节。
          const searchPath = filepath.endsWith("/")
            ? filepath.replace(/\/+$/u, "")
            : filepath;
          if (matchesParent && !matchesParent(searchPath)) {
            offset = end + 1;
            continue;
          }
          const filename = path.basename(searchPath);
          if (matchesName && !matchesName(filename)) {
            offset = end + 1;
            continue;
          }
          if (anchoredQuery && !segmentQueries) {
            // 前后锚点必须作用于真实名称；拼音候选独立参与同一个 fzf 查询。
            emitRecord(
              Buffer.from(filename.replaceAll("\t", " "), "utf8"),
              record,
            );
            if (enablePinyin) {
              const aliases = pinyinAlias(filename).split(" ").filter(Boolean);
              for (const alias of aliases)
                emitRecord(Buffer.from(alias, "utf8"), record);
            }
          } else {
            emitRecord(
              Buffer.from(projectPath(searchPath, filename), "utf8"),
              record,
            );
          }
          offset = end + 1;
        }
        flushBatch();
        if (diagnostics) diagnostics.transformMs += performance.now() - started;
        callback();
      } catch (error) {
        if (diagnostics) diagnostics.transformMs += performance.now() - started;
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
