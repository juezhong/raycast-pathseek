import { environment, getPreferenceValues } from "@raycast/api";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

export type Preferences = {
  searchRoots: string;
  includeHidden: boolean;
  followSymlinks: boolean;
  excludePatterns?: string;
  fdBinary?: string;
  fzfBinary?: string;
};

export type IndexMetadata = {
  version: 1;
  filename: string;
  createdAt: string;
  count: number;
  roots: string[];
};

const indexDirectory = environment.supportPath;
const metadataPath = path.join(indexDirectory, "index.json");

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function resolveRoot(value: string): string {
  const expanded = value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(expanded);
}

export function parseRoots(raw: string): string[] {
  return [...new Set(raw.split(/[;\r\n]+/).map((p) => p.trim()).filter(Boolean).map(resolveRoot))];
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findBinary(name: "fd" | "fzf", explicit?: string): Promise<string> {
  if (explicit?.trim()) {
    const file = resolveRoot(explicit.trim());
    if (await isExecutable(file)) return file;
    throw new Error(`Executable is not accessible: ${file}`);
  }

  const candidates = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".cargo/bin"),
    ...(process.env.PATH || "").split(path.delimiter),
  ];

  for (const dir of [...new Set(candidates.filter(Boolean))]) {
    const file = path.join(dir, name);
    if (await isExecutable(file)) return file;
  }

  throw new Error(`Cannot locate ${name}. Run 'brew install fd fzf', or set its absolute path in PathSeek preferences.`);
}

export function indexFilePath(metadata: IndexMetadata): string {
  // 元数据只允许指向当前扩展的数据文件，避免读取任意外部路径。
  if (!/^index-[a-f0-9-]+\.nul$/.test(metadata.filename)) {
    throw new Error("Invalid index filename");
  }
  return path.join(indexDirectory, metadata.filename);
}

export async function readIndex(): Promise<IndexMetadata | null> {
  let text: string;
  try {
    text = await readFile(metadataPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const data: unknown = JSON.parse(text);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) || data.version !== 1 ||
    !("filename" in data) || typeof data.filename !== "string" ||
    !("count" in data) || typeof data.count !== "number" ||
    !("roots" in data) || !Array.isArray(data.roots) ||
    !("createdAt" in data) || typeof data.createdAt !== "string"
  ) {
    throw new Error("Invalid index metadata. Rebuild the index.");
  }

  const metadata = data as IndexMetadata;
  await access(indexFilePath(metadata));
  return metadata;
}

async function runFd(fdPath: string, args: string[], outputPath: string): Promise<number> {
  const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: string[] = [];
  let count = 0;
  child.stderr.on("data", (data: Buffer) => {
    if (chunks.join("").length < 4096) chunks.push(data.toString("utf8"));
  });

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      for (const byte of chunk) if (byte === 0) count++;
      callback(null, chunk);
    },
  });

  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`fd failed (exit ${code}): ${chunks.join("").trim()}`));
    });
  });

  try {
    await Promise.all([pipeline(child.stdout, meter, createWriteStream(outputPath, { flags: "a" })), completed]);
    return count;
  } catch (error) {
    child.kill();
    throw error;
  }
}

export async function rebuildIndex(): Promise<IndexMetadata> {
  const prefs = getPreferences();
  const roots = parseRoots(prefs.searchRoots);
  if (!roots.length) throw new Error("Set at least one search root in PathSeek preferences.");

  for (const root of roots) {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`Not a directory: ${root}`);
  }

  const fd = await findBinary("fd", prefs.fdBinary);
  await mkdir(indexDirectory, { recursive: true });
  const previousIndex = await readIndex().catch(() => null);

  const id = randomUUID();
  const indexName = `index-${id}.nul`;
  const tempPath = path.join(indexDirectory, `${indexName}.tmp`);
  const finalPath = path.join(indexDirectory, indexName);
  const metadataTemp = path.join(indexDirectory, `index-${id}.json.tmp`);

  const args = ["--absolute-path", "--print0"];
  if (prefs.includeHidden) args.push("--hidden");
  if (prefs.followSymlinks) args.push("--follow");
  for (const pattern of (prefs.excludePatterns || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    args.push("--exclude", pattern);
  }

  let total = 0;
  try {
    await writeFile(tempPath, "", { flag: "wx" });
    for (const root of roots) {
      total += await runFd(fd, [...args, ".", root], tempPath);
    }

    // 元数据原子发布前，先生成完整的数据文件；失败时仍使用旧版索引。
    await rename(tempPath, finalPath);
    const metadata: IndexMetadata = {
      version: 1,
      filename: indexName,
      createdAt: new Date().toISOString(),
      count: total,
      roots,
    };
    await writeFile(metadataTemp, JSON.stringify(metadata, null, 2), "utf8");
    await rename(metadataTemp, metadataPath);

    // 仅保留现用索引和上一代索引，避免反复手动重建持续占用磁盘。
    // 清理失败不应让已成功发布的新索引失效。
    try {
      for (const filename of await readdir(indexDirectory)) {
        if (!/^index-[a-f0-9-]+\\.nul$/.test(filename)) continue;
        if (filename === metadata.filename || filename === previousIndex?.filename) continue;
        await rm(path.join(indexDirectory, filename), { force: true });
      }
    } catch (error) {
      console.warn("Could not clean up retired indexes:", error);
    }
    return metadata;
  } catch (error) {
    await Promise.all([
      rm(tempPath, { force: true }).catch(() => undefined),
      rm(metadataTemp, { force: true }).catch(() => undefined),
      rm(finalPath, { force: true }).catch(() => undefined),
    ]);
    throw error;
  }
}
