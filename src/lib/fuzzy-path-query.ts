/**
 * '/' 是路径模式的唯一触发符。前面的片段按连续父目录层级匹配，
 * 最后一个片段仍交由原生 fzf 对目标自身名称进行匹配。
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

type Predicate = (name: string) => boolean;

/** 支持 fzf 对空格的转义，不会把不同目录段合并为一个搜索词。 */
function tokenize(pattern: string): string[] {
  const tokens: string[] = [];
  let word = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\" && i + 1 < pattern.length && /\s/u.test(pattern[i + 1])) {
      word += pattern[++i];
    } else if (/\s/u.test(char)) {
      if (word) tokens.push(word);
      word = "";
    } else {
      word += char;
    }
  }
  if (word) tokens.push(word);
  return tokens;
}

/** 与 fzf 模糊匹配的布尔条件一致：查询字符必须按顺序出现。 */
function orderedMatch(needle: string, value: string): boolean {
  let from = 0;
  for (const char of needle) {
    const index = value.indexOf(char, from);
    if (index === -1) return false;
    from = index + char.length;
  }
  return true;
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

function exactWordMatch(needle: string, value: string): boolean {
  let start = value.indexOf(needle);
  while (start !== -1) {
    const end = start + needle.length;
    const leading = start === 0 || !WORD_CHARACTER.test(value[start - 1]);
    const trailing = end === value.length || !WORD_CHARACTER.test(value[end]);
    if (leading && trailing) return true;
    start = value.indexOf(needle, start + 1);
  }
  return false;
}

function compileTerm(input: string, ignoreCase: boolean): Predicate {
  let term = input;
  const inverse = term.startsWith("!");
  if (inverse) term = term.slice(1);

  let kind: "fuzzy" | "exact" | "word" | "prefix" | "suffix" | "equal";
  if (term.startsWith("'")) {
    term = term.slice(1);
    kind = term.endsWith("'") ? "word" : "exact";
    if (kind === "word") term = term.slice(0, -1);
  } else if (term.startsWith("^")) {
    term = term.slice(1);
    kind = term.endsWith("$") ? "equal" : "prefix";
    if (kind === "equal") term = term.slice(0, -1);
  } else if (term.endsWith("$")) {
    term = term.slice(0, -1);
    kind = "suffix";
  } else {
    // fzf 中 !term 默认是反向精确包含，而不是反向模糊匹配。
    kind = inverse ? "exact" : "fuzzy";
  }

  if (!term) return () => false;
  const needle = ignoreCase ? term.toLowerCase() : term;

  const positive: Predicate =
    kind === "fuzzy"
      ? (name) => orderedMatch(needle, name)
      : kind === "exact"
        ? (name) => name.includes(needle)
        : kind === "word"
          ? (name) => exactWordMatch(needle, name)
          : kind === "prefix"
            ? (name) => name.startsWith(needle)
            : kind === "suffix"
              ? (name) => name.endsWith(needle)
              : (name) => name === needle;

  return inverse ? (name) => !positive(name) : positive;
}

type SegmentMatcher = (
  name: string,
  getAlias: (name: string) => string,
) => boolean;

/**
 * 每个目录段在搜索开始时只解析一次 Extended Search：
 * 空格表示 AND；独立的 | 表示相邻条件之间的 OR。
 * 大写字母触发 fzf Smart Case，不包含运算符的纯拉丁查询仍支持拼音。
 */
function compileSegment(pattern: string): SegmentMatcher {
  const ignoreCase = pattern === pattern.toLowerCase();
  const tokens = tokenize(pattern);
  const groups: Predicate[][] = [];
  let alternative = false;
  for (const token of tokens) {
    if (token === "|") {
      alternative = true;
      continue;
    }
    const predicate = compileTerm(token, ignoreCase);
    if (alternative && groups.length) groups[groups.length - 1].push(predicate);
    else groups.push([predicate]);
    alternative = false;
  }
  const evaluate = (name: string) =>
    groups.every((alternatives) => alternatives.some((test) => test(name)));

  return (name, getAlias) => {
    const comparable = ignoreCase ? name.toLowerCase() : name;
    if (evaluate(comparable)) return true;
    if (!/\p{Script=Han}/u.test(name)) return false;
    const alias = getAlias(name);
    if (!alias) return false;
    const comparableAlias = ignoreCase ? alias.toLowerCase() : alias;
    return (
      evaluate(ignoreCase ? (name + " " + alias).toLowerCase() : name + " " + alias) ||
      comparableAlias.split(" ").some((reading) => evaluate(reading))
    );
  };
}

/**
 * 每次查询编译一次；每个索引文件仅检查最末尾的 N 个父目录。
 * 不分割整个路径，也不启动额外的 fzf 子进程或读取目录。
 */
export function compileFuzzyParentPathMatcher(
  directoryPatterns: readonly string[],
  getAlias: (name: string) => string,
): (filepath: string) => boolean {
  const matchers = directoryPatterns.map(compileSegment);
  return (filepath: string) => {
    if (!matchers.length) return true;
    let end = filepath.lastIndexOf("/");
    if (end <= 0) return false;

    for (let i = matchers.length - 1; i >= 0; i--) {
      const begin = filepath.lastIndexOf("/", end - 1);
      const dirname = filepath.slice(begin + 1, end);
      if (!dirname || !matchers[i](dirname, getAlias)) return false;
      end = begin;
      if (end < 0 && i > 0) return false;
    }
    return true;
  };
}

/** 测试与外部调用的便利入口；搜索热路径使用预编译版本。 */
export function matchesFuzzyParentPath(
  filepath: string,
  directoryPatterns: readonly string[],
  getAlias: (name: string) => string,
): boolean {
  return compileFuzzyParentPathMatcher(directoryPatterns, getAlias)(filepath);
}

/**
 * 无 Extended Search 运算符的路径查询由原生 fzf 执行完整路径模糊匹配和排序。
 * 其余查询仍兼容原来的逐段锚点、否定和 AND/OR 语义。
 */
export function isNativeFuzzyPathQuery(query: FuzzyPathQuery): boolean {
  return [...query.directoryPatterns, query.nameQuery].every(
    (part) => !/[\s^$'!|\\]/u.test(part),
  );
}

/** 只做目标名称层级检查，不取代 fzf 的实际匹配评分。 */
export function compileFuzzyTargetNameMatcher(
  pattern: string,
  getAlias: (name: string) => string,
): (name: string) => boolean {
  const matcher = compileSegment(pattern);
  return (name: string) => matcher(name, getAlias);
}
