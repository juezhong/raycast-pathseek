import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import {
  AliasPathMapper,
  discoverSelectiveSymlinks,
} from "../src/lib/selective-symlinks.ts";

const execFileAsync = promisify(execFile);

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("only directly selected symlink-directory entries are expanded, preserving shortcut paths", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "pathseek-symlink-folder-"));
  try {
    const target = path.join(temp, "real project");
    const shortcuts = path.join(temp, "Shortcuts");
    await mkdir(target);
    await mkdir(shortcuts);
    await mkdir(path.join(target, "drivers"));
    await writeFile(path.join(target, "drivers", "中文 文件.c"), "hello");
    await writeFile(path.join(target, "a\nb.c"), "hello");
    const alias = path.join(shortcuts, "kernel");
    const hidden = path.join(shortcuts, ".hidden-kernel");
    await symlink(target, alias);
    await symlink(target, hidden);
    await symlink(path.join(target, "drivers", "中文 文件.c"), path.join(shortcuts, "file-link.c"));
    await symlink(path.join(temp, "missing"), path.join(shortcuts, "broken"));
    // 目标目录中的循环链接不会被继续展开。
    await symlink(shortcuts, path.join(target, "back-to-shortcuts"));

    const normal = await execFileAsync(
      "fd", ["--absolute-path", "--print0", ".", shortcuts],
      { encoding: "buffer" },
    );
    const normalText = normal.stdout.toString("utf8");
    assert.ok(normalText.includes(alias + "\0"));
    assert.ok(!normalText.includes(alias + "/drivers/中文 文件.c"));

    const visible = await discoverSelectiveSymlinks(shortcuts, false);
    assert.equal(visible.linksSeen, 3);
    assert.equal(visible.targets.length, 1);
    assert.equal(visible.linksSkipped, 2);
    assert.deepEqual(visible.targets[0], {
      aliasPath: alias,
      realPath: await realpath(target),
    });

    const all = await discoverSelectiveSymlinks(shortcuts, true);
    assert.equal(all.targets.length, 2);

    const { stdout } = await execFileAsync(
      "fd", ["--absolute-path", "--print0", ".", all.targets[0].realPath],
      { encoding: "buffer" },
    );
    const mapped = await collect(
      Readable.from([stdout]).pipe(new AliasPathMapper(visible.targets[0])),
    );
    const paths = mapped.toString("utf8").split("\0").filter(Boolean);
    assert.ok(paths.includes(alias + "/drivers/中文 文件.c"));
    assert.ok(paths.includes(alias + "/a\nb.c"));
    assert.ok(paths.includes(alias + "/back-to-shortcuts"));
    assert.ok(!paths.some((p) => p.includes("back-to-shortcuts/kernel/")));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("alias mapping respects NUL chunk boundaries and rejects unrelated input", async () => {
  const target = { realPath: "/real/project", aliasPath: "/links/project" };
  const original = Buffer.from("/real/project/a\nb.c\0/real/project/中文 文件.c\0");
  for (const size of [1, 2, 7, 31]) {
    const pieces = [];
    for (let i = 0; i < original.length; i += size) pieces.push(original.subarray(i, i + size));
    const mapped = await collect(Readable.from(pieces).pipe(new AliasPathMapper(target)));
    assert.deepEqual(mapped, Buffer.from("/links/project/a\nb.c\0/links/project/中文 文件.c\0"));
  }
  await assert.rejects(
    collect(Readable.from([Buffer.from("/real/project-other/a\0")]).pipe(new AliasPathMapper(target))),
  );
  await assert.rejects(
    collect(Readable.from([Buffer.from("/real/project/unfinished")]).pipe(new AliasPathMapper(target))),
  );
});
