import path from "node:path";

/**
 * 单个 '/' 将查询拆成目录层级：前面的段匹配连续的父目录，
 * 最后一段交由原生 fzf 对真实文件/目录名称执行模糊过滤。
 * 不带 '/' 的原有名称搜索完全不受影响。
 */
export type FuzzyPathQuery = {
  directoryPatterns: string[];
  nameQuery: string;
};

export function parseFuzzyPathQuery(query: string): FuzzyPathQuery | null {
  if (!query.includes("/")) return null;

  const parts = query.trim().split("/");
  if (parts[0] === "") parts.shift();
  if (parts.length < 2 || parts.length > 17)
    throw new Error("Path query must contain 1 to 16 directory patterns");

  const nameQuery = parts.pop()!.trim();
  const directoryPatterns = parts.map((part) => part.trim());
  if (directoryPatterns.some((part) => !part))
    throw new Error("Path query cannot contain empty directory levels (//)");
  if (directoryPatterns.some((part) => part.length > 128))
    throw new Error("A directory pattern exceeds 128 characters");
  if (nameQuery.length > 512)
    throw new Error("The final filename pattern is too long");

  return { directoryPatterns, nameQuery };
}

/** 模糊匹配只要求字符保持顺序，允许字符之间有间隔。 */
function fuzzySubsequence(needle: string, haystack: string): boolean {
  let offset = 0;
  for (const letter of needle) {
    const found = haystack.indexOf(letter, offset);
    if (found < 0) return false;
    offset = found + letter.length;
  }
  return true;
}

/**
 * 父目录的每一层分别匹配其自身名称或拼音；不跨目录拼接字符。
 * query a/b 指向直接位于某个 a* 目录下的 b* 项，允许省略更早的祖先层级。
 * 拼音查询采用和普通查询相同的动态拼音库，不写入额外索引。
 */
export function matchesFuzzyParentPath(
  filepath: string,
  directoryPatterns: readonly string[],
  getAlias: (name: string) => string,
): boolean {
  if (!directoryPatterns.length) return true;

  const parents = path.dirname(filepath).split(path.sep).filter(Boolean);
  if (parents.length < directoryPatterns.length) return false;
  const start = parents.length - directoryPatterns.length;

  return directoryPatterns.every((pattern, index) => {
    const name = parents[start + index].toLowerCase();
    const tokens = pattern.toLowerCase().split(/\s+/u);
    if (tokens.every((token) => fuzzySubsequence(token, name))) return true;

    let alias: string | undefined;
    return tokens.every((token) => {
      if (fuzzySubsequence(token, name)) return true;
      alias ??= getAlias(parents[start + index]).toLowerCase();
      return fuzzySubsequence(token, alias);
    });
  });
}
