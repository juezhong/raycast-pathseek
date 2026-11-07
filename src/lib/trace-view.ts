import type { CommandTraceRecord } from "./command-trace";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 日志仍以 ISO UTC 保存；只在渲染时使用用户 macOS 当前时区。 */
export function formatLocalTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";

  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const zone =
    "UTC" +
    sign +
    pad(Math.floor(Math.abs(minutes) / 60)) +
    ":" +
    pad(Math.abs(minutes) % 60);
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds()) +
    " " +
    zone
  );
}

/** 合并同一调用的开始/结束事件，避免两行 JSON 造成诊断阅读负担。 */
export function summarizeTraceRecords(records: CommandTraceRecord[]): string {
  if (!records.length) return "暂无 fd/fzf 调用记录。";

  const grouped = new Map<
    string,
    { start?: CommandTraceRecord; end?: CommandTraceRecord }
  >();
  for (const item of records) {
    const group = grouped.get(item.id) ?? {};
    if (item.phase === "start") group.start = item;
    else group.end = item;
    grouped.set(item.id, group);
  }

  const tick = String.fromCharCode(96);
  const lines = [...grouped.values()].reverse().map(({ start, end }) => {
    const item = end ?? start;
    if (!item) return "";
    const time = formatLocalTimestamp(item.at);
    const tool = item.tool;
    const reason = item.reason === "manual-rebuild" ? "手动构建" : "按需搜索";
    const outcome =
      end?.outcome === "success"
        ? "成功"
        : end?.outcome === "limit-reached"
          ? "达到结果上限"
          : end?.outcome === "cancelled"
            ? "已取消"
            : end?.outcome === "failure"
              ? "失败"
              : end
                ? "已结束"
                : "未记录结束事件";
    const duration =
      end?.durationMs === undefined ? "" : " · " + end.durationMs + " ms";
    const count =
      end?.resultCount === undefined ? "" : " · " + end.resultCount + " 条";
    const exit =
      end?.exitCode === undefined ? "" : " · exit=" + String(end.exitCode);
    const error = end?.errorCode ? " · error=" + end.errorCode : "";
    const invocation = start?.invocation ?? end?.invocation ?? "";
    return (
      "- **" +
      time +
      "** · " +
      tick +
      tool +
      tick +
      " · " +
      reason +
      " · **" +
      outcome +
      "**" +
      duration +
      count +
      exit +
      error +
      "\n  " +
      tick +
      invocation +
      tick
    );
  });

  return lines.filter(Boolean).join("\n");
}
