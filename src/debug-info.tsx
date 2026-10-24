import { Action, ActionPanel, Detail, environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { useEffect, useState } from "react";

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
    const { stdout } = await run("/usr/bin/sw_vers", ["-productVersion"], { timeout: 3000 });
    return stdout.trim() || "unavailable";
  } catch {
    return `unavailable (Darwin ${os.release()})`;
  }
}

async function collectDiagnostics(): Promise<Diagnostics> {
  const root = environment.supportPath;
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

  try {
    const entries = await readdir(root);
    generationCount = String(entries.filter((name) => /^index-[a-f0-9-]+\.nul$/.test(name)).length);
  } catch (error) {
    generationCount = `unavailable (${errorCode(error)})`;
  }

  let raw: string | undefined;
  try {
    raw = await readFile(path.join(root, "index.json"), "utf8");
    metadataStatus = "present";
  } catch (error) {
    metadataStatus = `unavailable (${errorCode(error)})`;
    activeStatus = "not checked";
  }

  if (raw !== undefined) {
    try {
      const meta: unknown = JSON.parse(raw);
      if (
        !meta ||
        typeof meta !== "object" ||
        !("filename" in meta) ||
        typeof meta.filename !== "string" ||
        !/^index-[a-f0-9-]+\.nul$/.test(meta.filename)
      ) {
        metadataStatus = "invalid structure";
        activeStatus = "not checked";
      } else {
        const payload = meta as Record<string, unknown>;
        declaredCount = typeof payload.count === "number" ? String(payload.count) : "invalid";
        createdAt = typeof payload.createdAt === "string" ? payload.createdAt : "invalid";
        rootCount = Array.isArray(payload.roots) ? String(payload.roots.length) : "invalid";
        try {
          const info = await stat(path.join(root, meta.filename));
          activeStatus = info.isFile() ? "present" : "not a regular file";
          indexBytes = String(info.size);
        } catch (error) {
          activeStatus = `missing/unavailable (${errorCode(error)})`;
        }
      }
    } catch {
      metadataStatus = "invalid JSON";
      activeStatus = "not checked";
    }
  }

  report.push(
    `- index.json: ${metadataStatus}`,
    `- active index file: ${activeStatus}`,
    `- active index size (bytes): ${indexBytes}`,
    `- metadata path count: ${declaredCount}`,
    `- root directories count: ${rootCount}`,
    `- last rebuild: ${createdAt}`,
    `- index generation files: ${generationCount}`,
    "",
    "> 此报告不包含用户名、绝对路径、搜索词或文件名，可粘贴到公开 Issue。",
    "> 终端 `node --version` 显示的是系统 Node.js 版本，可能不同于 Raycast 内部 Node.js。",
  );

  const copyText = report.join("\n");
  return { markdown: copyText, copyText };
}

export default function DebugInfo() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    collectDiagnostics()
      .then((value) => { if (active) setData(value); })
      .catch((failure: unknown) => {
        if (active) setError(`Failed to collect diagnostics (${errorCode(failure)})`);
      });
    return () => { active = false; };
  }, []);

  return (
    <Detail
      isLoading={!data && !error}
      markdown={data?.markdown || `# Debug Info\n\n${error || "Collecting system and index status…"}`}
      actions={
        data ? (
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Sanitized Debug Info" content={data.copyText} />
            <Action.Open title="Open PathSeek GitHub Issue" target="https://github.com/juezhong/raycast-pathseek/issues/1" />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}
