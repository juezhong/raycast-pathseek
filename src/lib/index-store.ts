import { environment, getPreferenceValues } from "@raycast/api";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, constants } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, PassThrough, type Writable } from "node:stream";
import { createBrotliCompress, constants as zlibConstants } from "node:zlib";
import { PathPrefixEncoder } from "./index-codec.ts";
import lockfile from "proper-lockfile";
import { beginCommandTrace } from "./command-trace";
import { getConfiguredIndexRoots } from "./index-roots";
import { selectRebuildRoots } from "./index-root-paths";
import {
  ACTIVE_INDEX_FILENAME,
  cleanupLegacyIndexes,
  cleanupStaleBuildTemps,
  createStreamingIndexStage,
  finalizeStreamingIndexStage,
  publishIndex,
  readIndexHeader,
  type SavedIndexMetadata,
} from "./index-files";

export type IndexMetadata = SavedIndexMetadata;

// 开发版索引与正式安装版隔离，避免测试重建覆盖用户原有数据。
export const indexDirectory = environment.isDevelopment
  ? path.join(environment.supportPath, "index-development-v3")
  : environment.supportPath;
const metadataPath = path.join(indexDirectory, "index.json");

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function resolveRoot(value: string): string {
  const expanded =
    value === "~"
      ? os.homedir()
      : value.startsWith("~/")
        ? path.join(os.homedir(), value.slice(2))
        : value;
  return path.resolve(expanded);
}

export function parseRoots(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[;\r\n]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(resolveRoot),
    ),
  ];
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findBinary(
  name: "fd" | "fzf",
  explicit?: string,
): Promise<string> {
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

  throw new Error(
    `Cannot locate ${name}. Run 'brew install fd fzf', or set its absolute path in PathSeek preferences.`,
  );
}

export function indexFilePath(metadata: IndexMetadata): string {
  // 元数据只允许指向当前扩展的数据文件，避免读取任意外部路径。
  if (
    metadata.filename !== ACTIVE_INDEX_FILENAME &&
    !/^index-[a-f0-9-]+\.nul$/.test(metadata.filename)
  ) {
    throw new Error("Invalid index filename");
  }
  return path.join(indexDirectory, metadata.filename);
}

export async function readIndex(): Promise<IndexMetadata | null> {
  // Version 2 is a single self-describing, atomically replaced file.
  // It is always authoritative when present, even if a legacy index.json
  // remains from a previous plugin version.
  try {
    return await readIndexHeader(
      path.join(indexDirectory, ACTIVE_INDEX_FILENAME),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // Backward compatibility with pre-v2 UUID + index.json format. Old
  // generations are left alone until a successful v2 rebuild/migration.
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
    !("version" in data) ||
    data.version !== 1 ||
    !("filename" in data) ||
    typeof data.filename !== "string" ||
    !("count" in data) ||
    typeof data.count !== "number" ||
    !("roots" in data) ||
    !Array.isArray(data.roots) ||
    !("createdAt" in data) ||
    typeof data.createdAt !== "string"
  ) {
    throw new Error("Invalid legacy index metadata; rebuild the index");
  }
  const metadata = data as IndexMetadata;
  await access(indexFilePath(metadata));
  return { ...metadata, dataOffset: 0 };
}

async function runFd(
  fdPath: string,
  args: string[],
  output: Writable,
  reason: "manual-rebuild",
): Promise<number> {
  // Show effective flags without exposing directory names or exclude patterns.
  const flags = args.filter((arg) =>
    ["--absolute-path", "--print0", "--hidden", "--follow"].includes(arg),
  );
  const excludeCount = args.filter((arg) => arg === "--exclude").length;
  const invocation =
    "fd " +
    flags.join(" ") +
    (excludeCount ? " --exclude <redacted> (x" + excludeCount + ")" : "") +
    " . <root>";
  const trace = await beginCommandTrace("fd", reason, invocation);
  const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let exitCode: number | null | undefined;
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
      exitCode = code;
      if (code === 0) resolve();
      else
        reject(
          new Error(`fd failed (exit ${code}): ${chunks.join("").trim()}`),
        );
    });
  });

  try {
    await Promise.all([
      pipeline(
        child.stdout,
        meter,
        output,
        { end: false },
      ),
      completed,
    ]);
    await trace?.finish("success", count, exitCode);
    return count;
  } catch (error) {
    child.kill();
    await trace?.finish("failure", count, exitCode, error);
    throw error;
  }
}

/**
 * Only a deliberate call from the Rebuild Index command may start fd.
 * Launching Search Files, opening Index Status and launching Raycast never
 * invokes this function.
 */
export async function rebuildIndex(
  selectedRoots?: string[],
): Promise<IndexMetadata> {
  await mkdir(indexDirectory, { recursive: true });
  // Heartbeat prevents simultaneous rebuilds. Abandoned locks expire.
  const release = await lockfile.lock(indexDirectory, {
    realpath: false,
    stale: 120_000,
    update: 30_000,
    retries: 0,
  });

  try {
    // Maintenance runs only after the explicit Build/Rebuild action acquires
    // the write lock. Search Files and Index Status never touch these files.
    try {
      await cleanupStaleBuildTemps(indexDirectory);
    } catch (error) {
      console.warn("Stale build artifact cleanup deferred:", error);
    }
    const prefs = getPreferences();
    const roots = await selectRebuildRoots(selectedRoots, async () =>
      getConfiguredIndexRoots((await readIndex())?.roots),
    );
    if (!roots.length)
      throw new Error(
        "Choose folders in Rebuild Index before building your first index.",
      );

    for (const root of roots) {
      const info = await stat(root);
      if (!info.isDirectory()) throw new Error("Not a directory: " + root);
    }

    const fd = await findBinary("fd", prefs.fdBinary);
    const id = randomUUID();
    const stagedTemp = path.join(indexDirectory, "index-" + id + ".nul.tmp");
    const args = ["--absolute-path", "--print0"];
    if (prefs.includeHidden) args.push("--hidden");
    if (prefs.followSymlinks) args.push("--follow");
    for (const pattern of (prefs.excludePatterns || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      args.push("--exclude", pattern);
    }

    let total = 0;
    const input = new PassThrough({ highWaterMark: 1024 * 1024 });
    let writer: Promise<void> | undefined;
    try {
      await createStreamingIndexStage(stagedTemp);
      // 仅保存压缩数据，不落盘存储整个家目录的原始路径列表。
      writer = pipeline(
        input,
        new PathPrefixEncoder(),
        createBrotliCompress({
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
          },
        }),
        createWriteStream(stagedTemp, { flags: "a" }),
      );
      // 防止扫描尚未结束时编码管线提前失败产生 unhandled rejection。
      void writer.catch(() => undefined);
      for (const root of roots) {
        total += await runFd(
          fd,
          [...args, ".", root],
          input,
          "manual-rebuild",
        );
      }
      input.end();
      await writer;

      const metadata: IndexMetadata = {
        version: 3,
        filename: ACTIVE_INDEX_FILENAME,
        createdAt: new Date().toISOString(),
        count: total,
        roots,
      };

      const stagedMetadata = await finalizeStreamingIndexStage(stagedTemp, metadata);
      await publishIndex(stagedTemp, indexDirectory);

      try {
        await cleanupLegacyIndexes(indexDirectory);
      } catch (error) {
        console.warn("Legacy index cleanup deferred:", error);
      }
      return stagedMetadata;
    } catch (error) {
      input.destroy();
      await writer?.catch(() => undefined);
      throw error;
    } finally {
      await rm(stagedTemp, { force: true }).catch(() => undefined);
    }
  } finally {
    await release();
  }
}
