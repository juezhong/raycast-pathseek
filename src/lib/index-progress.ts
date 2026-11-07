import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

export type BuildPhase = "scanning" | "finalizing" | "published" | "failed";

export type IndexBuildProgress = {
  version: 1;
  buildId: string;
  phase: BuildPhase;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  inputBytes: number;
  pathCount: number;
  compressedBytes: number;
  lastInputAt?: string;
  lastOutputAt?: string;
  rootNumber: number;
  rootCount: number;
  compressionQuality: number;
  followSymlinks: boolean;
  includeHidden: boolean;
  cpuUserMs: number;
  cpuSystemMs: number;
  fdPid?: number;
  fdExitCode?: number | null;
  errorCode?: string;
};

const FILE = "build-progress.json";
const INTERVAL_MS = 2000;

function safeCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && /^[A-Z0-9_-]{1,32}$/.test(code)
    ? code
    : "UNKNOWN";
}

export function isProgressStale(
  progress: IndexBuildProgress,
  now = Date.now(),
): boolean {
  return (
    (progress.phase === "scanning" || progress.phase === "finalizing") &&
    now - Date.parse(progress.updatedAt) > 15000
  );
}

export async function readIndexBuildProgress(
  directory: string,
): Promise<IndexBuildProgress | null> {
  try {
    const data: unknown = JSON.parse(
      await readFile(path.join(directory, FILE), "utf8"),
    );
    if (
      !data ||
      typeof data !== "object" ||
      !("version" in data) ||
      data.version !== 1 ||
      !("buildId" in data) ||
      typeof data.buildId !== "string" ||
      !("phase" in data) ||
      !["scanning", "finalizing", "published", "failed"].includes(
        String(data.phase),
      ) ||
      !("updatedAt" in data) ||
      typeof data.updatedAt !== "string" ||
      !("inputBytes" in data) ||
      typeof data.inputBytes !== "number" ||
      !Number.isSafeInteger(data.inputBytes) ||
      !("pathCount" in data) ||
      typeof data.pathCount !== "number" ||
      !Number.isSafeInteger(data.pathCount)
    )
      return null;
    return data as IndexBuildProgress;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    return null;
  }
}

/** 仅在用户主动重建时记录数值进度，不保存路径名、搜索词和错误消息。 */
export async function beginIndexBuildProgress(
  directory: string,
  options: {
    buildId: string;
    rootCount: number;
    compressionQuality: number;
    followSymlinks: boolean;
    includeHidden: boolean;
  },
) {
  const started = performance.now();
  const cpuStart = process.cpuUsage();
  const file = path.join(directory, FILE);
  const temporary = path.join(directory, FILE + ".tmp");
  const progress: IndexBuildProgress = {
    version: 1,
    buildId: options.buildId,
    phase: "scanning",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    elapsedMs: 0,
    inputBytes: 0,
    pathCount: 0,
    compressedBytes: 0,
    rootNumber: 0,
    rootCount: options.rootCount,
    compressionQuality: options.compressionQuality,
    followSymlinks: options.followSymlinks,
    includeHidden: options.includeHidden,
    cpuUserMs: 0,
    cpuSystemMs: 0,
  };
  let pending = Promise.resolve();
  let latestErrorCode: string | undefined;

  function snapshot(): IndexBuildProgress {
    const cpu = process.cpuUsage(cpuStart);
    return {
      ...progress,
      updatedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - started),
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      ...(latestErrorCode ? { errorCode: latestErrorCode } : {}),
    };
  }

  function flush(): Promise<void> {
    const next = snapshot();
    pending = pending
      .catch(() => undefined)
      .then(async () => {
        await writeFile(temporary, JSON.stringify(next), "utf8");
        await rename(temporary, file);
      });
    return pending;
  }

  await flush();
  const timer = setInterval(() => {
    void flush().catch(() => undefined);
  }, INTERVAL_MS);
  timer.unref();

  async function finish(
    phase: "published" | "failed",
    error?: unknown,
  ): Promise<void> {
    clearInterval(timer);
    progress.phase = phase;
    if (error !== undefined) latestErrorCode = safeCode(error);
    await flush();
  }

  return {
    input(bytes: number, paths: number): void {
      progress.inputBytes += bytes;
      progress.pathCount += paths;
      if (bytes > 0) progress.lastInputAt = new Date().toISOString();
    },
    output(bytes: number): void {
      progress.compressedBytes += bytes;
      if (bytes > 0) progress.lastOutputAt = new Date().toISOString();
    },
    root(number: number): void {
      progress.rootNumber = number;
    },
    fdStarted(pid?: number): void {
      progress.fdPid = pid;
    },
    fdFinished(exitCode: number | null | undefined): void {
      progress.fdPid = undefined;
      progress.fdExitCode = exitCode;
    },
    finalizing(): void {
      progress.phase = "finalizing";
    },
    snapshot,
    flush,
    finish,
  };
}
