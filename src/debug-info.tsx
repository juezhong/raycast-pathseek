import { Action, ActionPanel, Detail, environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { useEffect, useState } from "react";
import { readIndex, indexFilePath, indexDirectory } from "./lib/index-store";
import { readIndexBuildProgress, isProgressStale } from "./lib/index-progress";
import {
  commandTracingEnabled,
  readCommandTrace,
  summarizeCommandTrace,
} from "./lib/command-trace";

const run = promisify(execFile);

type Diagnostics = {
  markdown: string;
  copyText: string;
};

function errorCode(error: unknown): string {
  // 错误消息中可能携带真实用户路径，诊断报告只保留错误码。
  const err = error as NodeJS.ErrnoException;
  return typeof err?.code === "string" ? err.code : "UNKNOWN";
}

async function getMacOSVersion(): Promise<string> {
  try {
    const { stdout } = await run("/usr/bin/sw_vers", ["-productVersion"], {
      timeout: 3000,
    });
    return stdout.trim() || "unavailable";
  } catch {
    return `unavailable (Darwin ${os.release()})`;
  }
}

async function collectDiagnostics(): Promise<Diagnostics> {
  const root = indexDirectory;
  const report: string[] = [
    "## PathSeek 诊断信息（已隐藏绝对路径）",
    "",
    `- macOS: ${await getMacOSVersion()}`,
    `- CPU architecture: ${os.arch()}`,
    `- Raycast: ${environment.raycastVersion}`,
    `- Node.js (Raycast runtime): ${process.version}`,
    `- Development extension: ${environment.isDevelopment ? "yes" : "no"}`,
    `- Extension: ${environment.extensionName}`,
    "",
    "## 持久化索引",
  ];

  let metadataStatus = "unknown";
  let activeStatus = "unknown";
  let indexBytes = "unknown";
  let declaredCount = "unknown";
  let generationCount = "unknown";
  let createdAt = "unknown";
  let rootCount = "unknown";
  let stagedBytes = 0;
  let stagedCount = 0;

  try {
    const entries = await readdir(root);
    for (const name of entries) {
      if (!/^index-[a-f0-9-]+\\.nul\\.tmp$/.test(name)) continue;
      const fileInfo = await stat(path.join(root, name)).catch(() => null);
      if (fileInfo?.isFile()) { stagedBytes += fileInfo.size; stagedCount++; }
    }
    generationCount = String(
      entries.filter(
        (name) => name === "index.nul" || /^index-[a-f0-9-]+\.nul$/.test(name),
      ).length,
    );
  } catch (error) {
    generationCount = `unavailable (${errorCode(error)})`;
  }

  try {
    const metadata = await readIndex();
    if (!metadata) {
      metadataStatus = "not built";
      activeStatus = "not checked";
    } else {
      metadataStatus =
        metadata.version === 3
          ? "v3 compressed prefix + Brotli"
          : metadata.version === 2
            ? "v2 embedded header"
            : "v1 legacy index.json";
      declaredCount = String(metadata.count);
      rootCount = String(metadata.roots.length);
      createdAt = metadata.createdAt;
      const info = await stat(indexFilePath(metadata));
      activeStatus = info.isFile() ? "present" : "not a regular file";
      indexBytes = String(info.size);
    }
  } catch (error) {
    metadataStatus = "invalid or inaccessible";
    activeStatus = "missing/unavailable (" + errorCode(error) + ")";
  }

  report.push(
    `- index format/metadata: ${metadataStatus}`,
    `- active index file: ${activeStatus}`,
    `- active index size (bytes): ${indexBytes}`,
    `- metadata path count: ${declaredCount}`,
    `- root directories count: ${rootCount}`,
    `- last rebuild: ${createdAt}`,
    `- index generation files: ${generationCount}`,
    `- staging files: ${stagedCount}`,
    `- staging bytes: ${stagedBytes}`,
    "",
    "> 此报告不包含用户名、绝对路径、搜索词或文件名，可粘贴到公开 Issue。",
    "> 终端 `node --version` 显示的是系统 Node.js 版本，可能不同于 Raycast 内部 Node.js。",
  );

  report.push("", "## 重建进度（数值指标，不含实际文件路径）");
  const progress = await readIndexBuildProgress(root);
  if (!progress) {
    report.push("No build-progress record (build may not have started in this version).");
  } else {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(progress.updatedAt)) / 1000));
    const rate = progress.elapsedMs > 0
      ? (progress.inputBytes / 1048576) / (progress.elapsedMs / 1000)
      : 0;
    report.push(
      `- phase: ${progress.phase}`,
      `- progress heartbeat age: ${ageSeconds} seconds`,
      `- heartbeat stale (>15s): ${isProgressStale(progress) ? "yes (may have been terminated)" : "no"}`,
      `- elapsed milliseconds: ${progress.elapsedMs}`,
      `- root number/count: ${progress.rootNumber}/${progress.rootCount}`,
      `- scanned path count: ${progress.pathCount}`,
      `- raw input bytes: ${progress.inputBytes}`,
      `- compressed output bytes: ${progress.compressedBytes}`,
      `- mean input rate: ${rate.toFixed(2)} MiB/s`,
      `- compression quality: ${progress.compressionQuality}`,
      `- follow symlinks: ${progress.followSymlinks}`,
      `- include hidden: ${progress.includeHidden}`,
      `- extension CPU user/system ms: ${progress.cpuUserMs}/${progress.cpuSystemMs} (fd child excluded)`,
      `- fd pid: ${progress.fdPid ?? "none"}`,
      `- last fd exit code: ${progress.fdExitCode ?? "unknown"}`,
      `- last raw input at: ${progress.lastInputAt ?? "not yet observed"}`,
      `- last compressed output at: ${progress.lastOutputAt ?? "not yet observed"}`,
      `- error code: ${progress.errorCode ?? "none"}`,
      "",
      "> 心跳持续更新只能证明扩展仍在记录进度，不代表扫描或压缩一直有数据输出。"
    );
  }

  report.push("", "## fd/fzf 调用记录（开发者选项）");
  if (commandTracingEnabled()) {
    const records = await readCommandTrace();
    report.push(
      "Tracing: enabled (local, sanitized, maximum 256 KiB per file)",
      "Method: Node.js child_process.spawn, no shell",
      summarizeCommandTrace(records),
      "",
      "> 正常查询不会启动 fd。**只有用户主动执行 Build Index 才调用 fd；不存在定时或打开搜索时自动建索引。**",
      "> 记录中的 started 表示已尝试调用；若无对应结束事件，可能被取消、终止或仍在运行。",
    );
  } else {
    report.push(
      "Tracing: disabled (default). No fd/fzf trace file is written during normal searches.",
    );
  }

  const copyText = report.join("\n");
  return { markdown: copyText, copyText };
}

export default function DebugInfo() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string>();
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let active = true;
    collectDiagnostics()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(`Failed to collect diagnostics (${errorCode(failure)})`);
      });
    return () => {
      active = false;
    };
  }, [refreshCount]);

  return (
    <Detail
      isLoading={!data && !error}
      markdown={
        data?.markdown ||
        `# Debug Info\n\n${error || "Collecting system and index status…"}`
      }
      actions={
        data ? (
          <ActionPanel>
            <Action.CopyToClipboard
              title="Copy Sanitized Debug Info"
              content={data.copyText}
            />
            <Action
              title="Refresh Diagnostics"
              onAction={() => setRefreshCount((count) => count + 1)}
            />
            <Action.Open
              title="Open PathSeek GitHub Issue"
              target="https://github.com/juezhong/raycast-pathseek/issues/1"
            />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}
