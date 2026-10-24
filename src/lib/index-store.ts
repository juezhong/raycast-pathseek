import { environment, getPreferenceValues } from "@raycast/api";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, constants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import lockfile from "proper-lockfile";

export type Preferences = {
  searchRoots: string;
  includeHidden: boolean;
  followSymlinks: boolean;
  excludePatterns?: string;
  fdBinary?: string;
  fzfBinary?: string;
};

export const ACTIVE_INDEX_FILENAME = "index.nul";

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
  if (metadata.filename !== ACTIVE_INDEX_FILENAME && !/^index-[a-f0-9-]+\.nul$/.test(metadata.filename)) {
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

export const AUTO_REBUILD_DAYS = 15;
const AUTO_REBUILD_MS = AUTO_REBUILD_DAYS * 24 * 60 * 60 * 1000;
const AUTO_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const autoRefreshStatePath = path.join(indexDirectory, "auto-refresh.json");

export function isIndexStale(metadata: IndexMetadata, now = Date.now()): boolean {
  const builtAt = Date.parse(metadata.createdAt);
  return !Number.isFinite(builtAt) || now - builtAt >= AUTO_REBUILD_MS;
}

/**
 * Refresh only when Search Files is opened and the index is at least 15 days
 * old. There is no always-on daemon or time-based background scheduler.
 * Failed attempts are limited to once every 24 hours.
 */
export async function refreshExpiredIndex(metadata: IndexMetadata): Promise<IndexMetadata | null> {
  if (!isIndexStale(metadata)) return null;
  try {
    const attempt = JSON.parse(await readFile(autoRefreshStatePath, "utf8")) as { lastAttempt?: string };
    if (typeof attempt.lastAttempt === "string" &&
        Date.now() - Date.parse(attempt.lastAttempt) < AUTO_RETRY_DELAY_MS) {
      return null;
    }
  } catch {
    // First run or damaged retry marker.
  }

  await mkdir(indexDirectory, { recursive: true });
  await writeFile(autoRefreshStatePath, JSON.stringify({ lastAttempt: new Date().toISOString() }));
  // Also serializes against a manual rebuild in another Raycast process.
  return rebuildIndex({ skipIfFresh: true });
}

/**
 * Delete older index generations only AFTER a new file has been published.
 * Runs within the exclusive cross-process rebuild lock.
 */
/**
 * Legacy cleanup only. Current generations always use a stable index.nul
 * pathname: an atomic rename replaces its content without leaving readers
 * with stale generation-specific names. Legacy UUID files get a grace period
 * because a search command may still hold an old metadata snapshot.
 */
async function cleanupLegacyGenerations(): Promise<void> {
  const LEGACY_GRACE_MS = 24 * 60 * 60 * 1000;
  const published = await readIndex();
  if (!published || published.filename !== ACTIVE_INDEX_FILENAME) return;

  const entries = await readdir(indexDirectory);
  for (const filename of entries) {
    if (!/^index-[a-f0-9-]+\.nul$/.test(filename)) continue;
    const filepath = path.join(indexDirectory, filename);
    const fileInfo = await stat(filepath).catch(() => null);
    if (!fileInfo || Date.now() - fileInfo.mtimeMs < LEGACY_GRACE_MS) continue;
    // This does not touch index.nul, nor unrecognized files.
    await rm(filepath, { force: true });
  }
}

export async function rebuildIndex(options: { skipIfFresh?: boolean } = {}): Promise<IndexMetadata> {
  await mkdir(indexDirectory, { recursive: true });
  // Heartbeat prevents simultaneous rebuilds. Abandoned locks expire.
  const release = await lockfile.lock(indexDirectory, {
    realpath: false,
    stale: 120_000,
    update: 30_000,
    retries: 0,
  });

  try {
    // Another window may have finished rebuilding while this process waited
    // for the lock. Do not scan again when the current index is already fresh.
    if (options.skipIfFresh) {
      const current = await readIndex().catch(() => null);
      if (current && !isIndexStale(current)) return current;
    }
    const prefs = getPreferences();
    const roots = parseRoots(prefs.searchRoots);
    if (!roots.length) throw new Error("Set at least one search root in PathSeek preferences.");

    for (const root of roots) {
      const info = await stat(root);
      if (!info.isDirectory()) throw new Error("Not a directory: " + root);
    }

    const fd = await findBinary("fd", prefs.fdBinary);
    const id = randomUUID();
    const indexName = ACTIVE_INDEX_FILENAME;
    const tempPath = path.join(indexDirectory, "index-" + id + ".nul.tmp");
    const finalPath = path.join(indexDirectory, indexName);
    const metadataTemp = path.join(indexDirectory, "index-" + id + ".json.tmp");
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

      // Atomic replacement: readers open a stable path and never chase a deleted UUID.
      await rename(tempPath, finalPath);
      const fileInfo = await stat(finalPath);
      if (!fileInfo.isFile()) throw new Error("Index is not a regular file");

      const metadata: IndexMetadata = {
        version: 1,
        filename: indexName,
        createdAt: new Date().toISOString(),
        count: total,
        roots,
      };
      await writeFile(metadataTemp, JSON.stringify(metadata, null, 2), "utf8");
      await rename(metadataTemp, metadataPath);

      // Cleanup is best-effort; publish success does not depend on cleanup.
      try {
        await cleanupLegacyGenerations();
      } catch (error) {
        console.warn("Index cleanup deferred:", error);
      }
      return metadata;
    } catch (error) {
      await Promise.all([
        rm(tempPath, { force: true }).catch(() => undefined),
        rm(metadataTemp, { force: true }).catch(() => undefined),
        // Never delete index.nul: it may already be in use, even if metadata
        // publication fails after the atomic replacement.
      ]);
      throw error;
    }
  } finally {
    await release();
  }
}
