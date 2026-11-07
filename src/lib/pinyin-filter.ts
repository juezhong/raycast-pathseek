import { Transform } from "node:stream";
import { pinyin } from "pinyin-pro";
import { MAX_FZF_PATH_BYTES } from "./fzf-output.ts";

const HAN_TEXT = /\p{Script=Han}+/gu;
const NUL = Buffer.from([0]);
const TAB = Buffer.from("\t");
const MAX_ALIAS_CHARS = 2048;

/**
 * 仅普通拉丁字母/空格查询启用拼音匹配。带有 ' ! ^ $ | 等 fzf
 * 扩展语法的查询必须走原始路径管道，保持 fzf 匹配规则不变。
 */
export function shouldUsePinyinAliases(query: string): boolean {
  return (
    query.length <= 80 && /^[a-zA-Z]+(?:\s+[a-zA-Z]+)*$/.test(query.trim())
  );
}

/**
 * 不改变持久化索引：仅当查询需要时，对含汉字的路径生成临时首字母/全拼
 * 搜索字段。没有全量索引缓存，流结束时自动回收。
 */
export function pinyinAlias(filepath: string): string {
  const words = filepath.match(HAN_TEXT);
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
 * 传给 fzf 的每条记录都是 `拼音别名<TAB>原始绝对路径<NUL>`。
 * 拼音字段不包含 TAB，因此从第一个 TAB 起即可完整恢复真实路径，
 * 即使原始文件名本身包含 TAB 或换行。
 */
export function createPinyinFilterInput(): Transform {
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
          const alias = pinyinAlias(record.toString("utf8"));
          const prefix = Buffer.from(alias, "utf8");
          if (prefix.length + TAB.length + record.length > MAX_FZF_PATH_BYTES)
            throw new Error("Pinyin search record exceeds size limit");
          this.push(Buffer.concat([prefix, TAB, record, NUL]));
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
    throw new Error("Malformed pinyin-augmented fzf output");
  return value.slice(separator + 1);
}
