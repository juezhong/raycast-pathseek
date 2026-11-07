import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerChild, terminateChild } from "../src/lib/managed-child.ts";

async function waitForPid(file) {
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const pid = Number(await readFile(file, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Child process did not create PID file");
}

test("repeated cancellation has one termination timer and does not accumulate close listeners", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pathseek-termination-"));
  const pidFile = path.join(dir, "child.pid");
  const child = spawn(
    process.execPath,
    [
      "-e",
      'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); ' +
        'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
      pidFile,
    ],
    { stdio: "ignore" },
  );
  registerChild(child);
  const closed = once(child, "close");
  try {
    const pid = await waitForPid(pidFile);
    const initialCloseListeners = child.listenerCount("close");
    for (let i = 0; i < 30; i++) {
      terminateChild(child, 100);
      assert.equal(child.listenerCount("close"), initialCloseListeners);
    }
    await closed;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    terminateChild(child);
    assert.equal(child.listenerCount("close"), 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
