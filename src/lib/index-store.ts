import { environment, getPreferenceValues } from "@raycast/api";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, constants } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, PassThrough, type Writable } from "node:stream";
import { createBrotliCompress, constants as zlibConstants } from "node:zlib";
import { PathPrefixEncoder } from "./index-codec.ts";
import { createNonClosingSink } from "./non-closing-sink";
import { beginIndexBuildProgress } from "./index-progress";
import { trackStagedIndex } from "./staged-index-lifecycle";
import {
  cancelledError,
  registerChild,
  terminateChild,
  throwIfAborted,
} from "./managed-child";
import lockfile from "proper-lockfile";
import { beginCommandTrace } from "./command-trace";
import {
  getConfiguredIndexRoots,
  getConfiguredSymlinkDirectory,
} from "./index-roots";
import {
  AliasPathMapper,
  discoverSelectiveSymlinks,
  type SelectiveSymlinkTarget,
} from "./selective-symlinks";
import { selectRebuildRoots } from "./index-root-paths";
import {
  ACTIVE_INDEX_FILENAME,
  cleanupLegacyIndexes,
  cleanupStaleBuildTemps,
  createStreamingIndexStage,
  finalizeStreamingIndexStage,
  publishIndex,
} from "./index-files";

import {
  indexPathAt,
  readStoredIndex,
  type ActiveIndexMetadata,
} from "./index-location";

export type IndexMetadata = ActiveIndexMetadata;

// Raycast 本身隔离扩展数据，不再额外区分开发版和本地安装索引。
export const indexDirectory = environment.supportPath;

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
  return indexPathAt(indexDirectory, metadata);
}

export async function readIndex(): Promise<IndexMetadata | null> {
  return readStoredIndex(indexDirectory);
}

async function runFd(
  fdPath: string,
  args: string[],
  output: Writable,
  reason: "manual-rebuild",
  progress: Awaited<ReturnType<typeof beginIndexBuildProgress>>,
  shortcut?: SelectiveSymlinkTarget,
  signal?: AbortSignal,
): Promise<number> {
  // Show effective flags without exposing directory names or exclude patterns.
  const flags = args.filter((arg) =>
    ["--absolute-path", "--print0", "--hidden"].includes(arg),
  );
  const excludeCount = args.filter((arg) => arg === "--exclude").length;
  const invocation =
    "fd " +
    flags.join(" ") +
    (excludeCount ? " --exclude <redacted> (x" + excludeCount + ")" : "") +
    (shortcut ? " . <selective-symlink-target>" : " . <root>");
  throwIfAborted(signal);
  const trace = await beginCommandTrace("fd", reason, invocation);
  throwIfAborted(signal);
  const child = spawn(fdPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  registerChild(child);
  progress.fdStarted(child.pid);
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  const abort = () => terminateChild(child);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let exitCode: number | null | undefined;
  const chunks: string[] = [];
  let count = 0;
  child.stderr.on("data", (data: Buffer) => {
    if (chunks.join("").length < 4096) chunks.push(data.toString("utf8"));
  });

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      let found = 0;
      for (
        let offset = chunk.indexOf(0);
        offset >= 0;
        offset = chunk.indexOf(0, offset + 1)
      )
        found++;
      count += found;
      progress.input(chunk.length, found);
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
      shortcut
        ? pipeline(
            child.stdout,
            new AliasPathMapper(shortcut),
            meter,
            createNonClosingSink(output),
          )
        : pipeline(child.stdout, meter, createNonClosingSink(output)),
      completed,
    ]);
    throwIfAborted(signal);
    progress.fdFinished(exitCode);
    await trace?.finish("success", count, exitCode);
    return count;
  } catch (error) {
    terminateChild(child);
    await closed;
    progress.fdFinished(exitCode);
    await trace?.finish("failure", count, exitCode, error);
    throw signal?.aborted ? cancelledError() : error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Only a deliberate call from the Rebuild Index command may start fd.
 * Launching Search Files, opening Index Status and launching Raycast never
 * invokes this function.
 */
export async function rebuildIndex(
  selectedRoots?: string[],
  signal?: AbortSignal,
): Promise<IndexMetadata> {
  throwIfAborted(signal);
  await mkdir(indexDirectory, { recursive: true });
  // Heartbeat prevents simultaneous rebuilds. Abandoned locks expire.
  const release = await lockfile.lock(indexDirectory, {
    realpath: false,
    stale: 120_000,
    update: 30_000,
    retries: 0,
  });

  try {
    throwIfAborted(signal);
    // Maintenance runs only after the explicit Build/Rebuild action acquires
    // the write lock. Search Files and Index Status never touch these files.
    try {
      // 已持有构建锁，不可能还有另一个正在运行的写入者；立即回收残留暂存文件。
      await cleanupStaleBuildTemps(indexDirectory, Date.now(), 0);
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

    const symlinkDirectory = await getConfiguredSymlinkDirectory();
    // 普通扫描始终不跟随软链接，仅显式目录内的直接目录链接另行扫描。
    const discovery = symlinkDirectory
      ? await discoverSelectiveSymlinks(
          symlinkDirectory,
          prefs.includeHidden === true,
        )
      : null;
    const scanRoots = [...roots];
    if (
      symlinkDirectory &&
      !roots.some((root) => {
        const relative = path.relative(root, symlinkDirectory);
        return (
          relative === "" ||
          (relative !== ".." &&
            !relative.startsWith(".." + path.sep) &&
            !path.isAbsolute(relative))
        );
      })
    )
      scanRoots.push(symlinkDirectory);

    const fd = await findBinary("fd", prefs.fdBinary);
    const id = randomUUID();
    const quality = [5, 7, 9, 11].includes(Number(prefs.compressionQuality))
      ? Number(prefs.compressionQuality)
      : 7;
    const progress = await beginIndexBuildProgress(indexDirectory, {
      buildId: id,
      rootCount: scanRoots.length + (discovery?.targets.length ?? 0),
      compressionQuality: quality,
      selectiveSymlinkTargets: discovery?.targets.length ?? 0,
      selectiveSymlinkSkipped: discovery?.linksSkipped ?? 0,
      includeHidden: prefs.includeHidden === true,
    });
    const stagedTemp = path.join(indexDirectory, "index-" + id + ".nul.tmp");
    const args = ["--absolute-path", "--print0"];
    if (prefs.includeHidden) args.push("--hidden");
    for (const pattern of (prefs.excludePatterns || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      args.push("--exclude", pattern);
    }

    let total = 0;
    const input = new PassThrough({ highWaterMark: 1024 * 1024 });
    let writer: Promise<void> | undefined;
    let untrackStage: (() => void) | undefined;
    const abortWriter = () => {
      // 索引文件创建之前取消时，不能对尚未接入 pipeline 的流发出未处理 error。
      if (writer) input.destroy(cancelledError());
    };
    signal?.addEventListener("abort", abortWriter, { once: true });
    try {
      throwIfAborted(signal);
      untrackStage = trackStagedIndex(stagedTemp);
      await createStreamingIndexStage(stagedTemp);
      throwIfAborted(signal);
      // 仅保存压缩数据，不落盘存储整个家目录的原始路径列表。
      writer = pipeline(
        input,
        new PathPrefixEncoder(),
        createBrotliCompress({
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: quality,
            [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
          },
        }),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            progress.output(chunk.length);
            callback(null, chunk);
          },
        }),
        createWriteStream(stagedTemp, { flags: "a" }),
      );
      // 防止扫描尚未结束时编码管线提前失败产生 unhandled rejection。
      void writer.catch(() => undefined);
      if (signal?.aborted) abortWriter();
      for (const [index, root] of scanRoots.entries()) {
        progress.root(index + 1);
        total += await runFd(
          fd,
          [...args, ".", root],
          input,
          "manual-rebuild",
          progress,
          undefined,
          signal,
        );
      }
      for (const [index, shortcut] of (discovery?.targets ?? []).entries()) {
        progress.root(scanRoots.length + index + 1);
        total += await runFd(
          fd,
          [...args, ".", shortcut.realPath],
          input,
          "manual-rebuild",
          progress,
          shortcut,
          signal,
        );
      }
      throwIfAborted(signal);
      progress.finalizing();
      input.end();
      await writer;
      throwIfAborted(signal);

      const metadata: IndexMetadata = {
        version: 3,
        filename: ACTIVE_INDEX_FILENAME,
        createdAt: new Date().toISOString(),
        count: total,
        roots,
      };

      const stagedMetadata = await finalizeStreamingIndexStage(
        stagedTemp,
        metadata,
      );
      throwIfAborted(signal);
      await publishIndex(stagedTemp, indexDirectory, signal);

      try {
        await cleanupLegacyIndexes(indexDirectory);
      } catch (error) {
        console.warn("Legacy index cleanup deferred:", error);
      }
      // 原子发布已提交，进度日志失败不得把成功的构建误报为失败。
      await progress.finish("published").catch(() => {
        console.warn("Index published, but progress status could not be saved");
      });
      return stagedMetadata;
    } catch (error) {
      input.destroy();
      await writer?.catch(() => undefined);
      await progress
        .finish(signal?.aborted ? "cancelled" : "failed", error)
        .catch(() => undefined);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortWriter);
      try {
        await rm(stagedTemp, { force: true });
        untrackStage?.();
      } catch (error) {
        // 保留退出兜底登记；不删除用户配置或已发布索引。
        console.warn(
          "Could not remove incomplete index stage:",
          (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
        );
      }
    }
  } finally {
    await release();
  }
}
