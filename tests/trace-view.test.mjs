import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { formatLocalTimestamp, summarizeTraceRecords } from "../src/lib/trace-view.ts";

const execFileAsync = promisify(execFile);

test("diagnostic time is local, never a hard-coded +8 offset", async () => {
  const sourceUrl = new URL("../src/lib/trace-view.ts", import.meta.url).href;
  const script =
    "import { formatLocalTimestamp } from " + JSON.stringify(sourceUrl) + ";" +
    "console.log(formatLocalTimestamp('2026-11-07T12:34:56.000Z'));";
  const shanghai = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { env: { ...process.env, TZ: "Asia/Shanghai" } },
  );
  const utc = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { env: { ...process.env, TZ: "UTC" } },
  );
  assert.equal(shanghai.stdout.trim(), "2026-11-07 20:34:56 UTC+08:00");
  assert.equal(utc.stdout.trim(), "2026-11-07 12:34:56 UTC+00:00");
});

test("invalid timestamps never crash the diagnostics view", () => {
  assert.equal(formatLocalTimestamp("not a date"), "unknown");
});

test("trace renderer joins start/end and retains failures, counts, duration and exit status", () => {
  const records = [
    {
      id: "one",
      at: "2026-11-07T12:00:00.000Z",
      tool: "fzf",
      reason: "fuzzy-query",
      invocation: "fzf --filter <redacted>",
      phase: "start",
    },
    {
      id: "one",
      at: "2026-11-07T12:00:00.250Z",
      tool: "fzf",
      reason: "fuzzy-query",
      invocation: "fzf --filter <redacted>",
      phase: "end",
      outcome: "success",
      durationMs: 250,
      resultCount: 12,
      exitCode: 0,
    },
    {
      id: "two",
      at: "2026-11-07T12:05:00.000Z",
      tool: "fd",
      reason: "manual-rebuild",
      invocation: "fd . <root>",
      phase: "start",
    },
  ];
  const displayed = summarizeTraceRecords(records);
  assert.equal((displayed.match(/fzf --filter/g) ?? []).length, 1);
  assert.match(displayed, /成功/);
  assert.match(displayed, /250 ms/);
  assert.match(displayed, /12 条/);
  assert.match(displayed, /exit=0/);
  assert.match(displayed, /未记录结束事件/);
  assert.match(displayed, /手动构建/);
});

test("empty trace and end-only event render without throwing", () => {
  assert.match(summarizeTraceRecords([]), /暂无/);
  assert.match(summarizeTraceRecords([{
    id: "end-only",
    at: "2026-11-07T12:00:00Z",
    tool: "fzf",
    reason: "fuzzy-query",
    invocation: "fzf <redacted>",
    phase: "end",
    outcome: "failure",
    errorCode: "ENOENT",
  }]), /失败/);
});
