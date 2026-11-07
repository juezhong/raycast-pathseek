import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { openIndexDataStream, readIndexHeader } from "../src/lib/index-files.ts";

const execFileAsync = promisify(execFile);

async function capture(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("offline converter leaves legacy v2 untouched and produces searchable v3", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "pathseek-convert-cli-"));
  try {
    const oldDirectory = path.join(temporary, "legacy");
    const outputDirectory = path.join(temporary, "test-output");
    await mkdir(oldDirectory);
    const source = path.join(oldDirectory, "index.nul");
    const paths = Buffer.from("/Users/test/中文文件.txt\0/Users/test/a\nb.txt\0/Users/test/subdir\0");
    const header = Buffer.from(JSON.stringify({
      version: 2,
      createdAt: "2026-11-07T00:00:00.000Z",
      count: 3,
      roots: ["/Users/test"],
    }));
    const prefix = Buffer.alloc(12);
    Buffer.from("PSIDX002").copy(prefix);
    prefix.writeUInt32LE(header.length, 8);
    const original = Buffer.concat([prefix, header, paths]);
    await writeFile(source, original);

    const runScript = (script, ...args) =>
      execFileAsync(process.execPath, ["--experimental-strip-types", script, ...args], {
        cwd: path.resolve("."),
      });

    const conversion = await runScript("scripts/convert-index.mjs", source, outputDirectory);
    assert.equal(JSON.parse(conversion.stdout).formatVersion, 3);

    const generated = path.join(outputDirectory, "index.nul");
    assert.equal((await readIndexHeader(generated)).version, 3);
    assert.deepEqual(await capture(await openIndexDataStream(generated)), paths);
    assert.deepEqual(await readFile(source), original);

    const benchmark = await runScript("scripts/benchmark-index.mjs", generated);
    const result = JSON.parse(benchmark.stdout);
    assert.equal(result.indexedPaths, 3);
    assert.equal(result.verifiedPaths, 3);
    assert.equal(result.rawBytes, paths.length);

    await assert.rejects(runScript("scripts/convert-index.mjs", source, outputDirectory));
    assert.deepEqual(await capture(await openIndexDataStream(generated)), paths);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
