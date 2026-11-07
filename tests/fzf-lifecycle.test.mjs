import assert from "node:assert/strict";
import { mkdtemp, chmod, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runFzfFilter } from "../src/lib/fzf-runner.ts";
import { prepareIndex, publishIndex } from "../src/lib/index-files.ts";

async function fixture(action) {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "pathseek-child-lifecycle-"),
  );
  try {
    const raw = path.join(dir, "raw");
    const staged = path.join(dir, "staged.tmp");
    await writeFile(raw, "/example/driver.c\0/example/中文.txt\0");
    await prepareIndex(raw, staged, {
      version: 3,
      count: 2,
      createdAt: new Date().toISOString(),
      roots: ["/example"],
    });
    await publishIndex(staged, dir);
    await action(dir, path.join(dir, "index.nul"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function waitForPid(file) {
  for (let i = 0; i < 300; i++) {
    try {
      return Number(await readFile(file, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Fake fzf child failed to start");
}

function assertGone(pid) {
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

test("real fzf searches compressed index with no-match status", async () => {
  await fixture(async (_, index) => {
    const matched = await runFzfFilter("fzf", index, "driver");
    assert.deepEqual(matched.paths, ["/example/driver.c"]);
    assert.equal(matched.cancelled, false);
    const missing = await runFzfFilter("fzf", index, "missing-pattern-987654");
    assert.deepEqual(missing.paths, []);
    assert.equal(missing.exitCode, 1);
  });
});

test("aborting an in-flight fzf kills child, reaps it, and returns no stale paths", async () => {
  await fixture(async (dir, index) => {
    const binary = path.join(dir, "fake-fzf");
    const pidFile = path.join(dir, "child.pid");
    await writeFile(
      binary,
      "#!/usr/bin/env node\n" +
        "const fs = require('node:fs');\n" +
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
        "process.stdin.resume(); setInterval(() => {}, 1000);\n",
    );
    await chmod(binary, 0o755);
    const controller = new AbortController();
    const task = runFzfFilter(
      binary,
      index,
      "driver",
      controller.signal,
      10000,
    );
    const pid = await waitForPid(pidFile);
    controller.abort();
    const result = await task;
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.paths, []);
    assertGone(pid);
  });
});

test("timeout escalates to SIGKILL when fzf ignores SIGTERM", async () => {
  await fixture(async (dir, index) => {
    const binary = path.join(dir, "stubborn-fzf");
    const pidFile = path.join(dir, "stubborn.pid");
    await writeFile(
      binary,
      "#!/usr/bin/env node\n" +
        "const fs = require('node:fs');\n" +
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
        "process.on('SIGTERM', () => {});\n" +
        "process.stdin.resume(); setInterval(() => {}, 1000);\n",
    );
    await chmod(binary, 0o755);
    // CI 或繁忙的 macOS 上 Node shebang 冷启动可能超过 250ms。
    // 等待真实超时/升级 SIGKILL，但不要用过短超时误判尚未启动。
    await assert.rejects(
      runFzfFilter(binary, index, "driver", undefined, 3000),
      /time limit/,
    );
    const pid = await waitForPid(pidFile);
    assertGone(pid);
  });
});

test("malformed fzf stdout is bounded and the child is reaped", async () => {
  await fixture(async (dir, index) => {
    const binary = path.join(dir, "malformed-fzf");
    const pidFile = path.join(dir, "malformed.pid");
    await writeFile(
      binary,
      "#!/usr/bin/env node\n" +
        "const fs = require('node:fs');\n" +
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
        "process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 65));\n" +
        "process.stdin.resume(); setInterval(() => {}, 1000);\n",
    );
    await chmod(binary, 0o755);
    const rejection = assert.rejects(
      runFzfFilter(binary, index, "driver", undefined, 10_000),
      /fzf output path exceeds size limit/,
    );
    const pid = await waitForPid(pidFile);
    await rejection;
    assertGone(pid);
  });
});

test("real fzf accepts Chinese pinyin initials, unordered terms, and native extended operators", async () => {
  await fixture(async (dir) => {
    const entries = [
      "/example/第一次.txt",
      "/example/第一次/记录.md",
      "/example/driver.c",
      "/example/abc" + String.fromCharCode(9) + "def.txt",
      "/example/普通中文.txt",
    ];
    const raw = path.join(dir, "pinyin-input.paths");
    const staged = path.join(dir, "pinyin-stage.nul.tmp");
    await writeFile(
      raw,
      entries.join(String.fromCharCode(0)) + String.fromCharCode(0),
    );
    await prepareIndex(raw, staged, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/example"],
    });
    await publishIndex(staged, dir);
    const index = path.join(dir, "index.nul");
    for (const query of ["dyc", "yc d", "d y c", "y c d", "diyici", "DYC"]) {
      const matched = await runFzfFilter("fzf", index, query);
      assert.ok(matched.paths.includes("/example/第一次.txt"), query);
      assert.ok(
        matched.paths.every((value) => entries.includes(value)),
        query,
      );
    }
    const exactChinese = await runFzfFilter("fzf", index, "'第一次");
    assert.ok(exactChinese.paths.includes("/example/第一次.txt"));
    const extended = await runFzfFilter("fzf", index, ".md$");
    assert.deepEqual(extended.paths, ["/example/第一次/记录.md"]);
    const noPinyinSyntaxOverride = await runFzfFilter("fzf", index, "'dyc");
    assert.equal(
      noPinyinSyntaxOverride.paths.includes("/example/第一次.txt"),
      true,
    );
    const tabName = await runFzfFilter("fzf", index, "abc");
    assert.ok(tabName.paths.includes(entries[3]));
  });
});

test("pinyin-mode cancellation closes the decoder and reaps the fzf child", async () => {
  await fixture(async (dir, index) => {
    const binary = path.join(dir, "fake-pinyin-fzf");
    const pidFile = path.join(dir, "pinyin-child.pid");
    await writeFile(
      binary,
      "#!/usr/bin/env node\n" +
        "const fs = require('node:fs');\n" +
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n` +
        "process.stdin.resume(); setInterval(() => {}, 1000);\n",
    );
    await chmod(binary, 0o755);
    const controller = new AbortController();
    const task = runFzfFilter(binary, index, "dyc", controller.signal, 10_000);
    const pid = await waitForPid(pidFile);
    controller.abort();
    const outcome = await task;
    assert.equal(outcome.cancelled, true);
    assert.deepEqual(outcome.paths, []);
    assertGone(pid);
  });
});

test("basename-only fzf prevents parent-directory false positives while preserving full paths", async () => {
  await fixture(async (dir) => {
    const entries = [
      "/data/2026/第一次.txt",
      "/data/第一次/2026_report.txt",
      "/data/current/2026第一次.txt",
      "/data/2026/driver.pdf",
      "/data/old/第一次.txt",
      "/data/2026/archive/abc.c",
      "/data/2026/中文目录",
    ];
    const raw = path.join(dir, "basename-cases.paths");
    const staged = path.join(dir, "basename-cases.nul.tmp");
    await writeFile(
      raw,
      entries.join(String.fromCharCode(0)) + String.fromCharCode(0),
    );
    await prepareIndex(raw, staged, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/data"],
    });
    await publishIndex(staged, dir);
    const index = path.join(dir, "index.nul");

    const yearAndPinyin = await runFzfFilter("fzf", index, "2026 dyc");
    assert.deepEqual(yearAndPinyin.paths, ["/data/current/2026第一次.txt"]);
    const plainYear = await runFzfFilter("fzf", index, "2026");
    assert.deepEqual(
      new Set(plainYear.paths),
      new Set(["/data/第一次/2026_report.txt", "/data/current/2026第一次.txt"]),
    );
    const initials = await runFzfFilter("fzf", index, "dyc");
    assert.deepEqual(
      new Set(initials.paths),
      new Set([
        "/data/2026/第一次.txt",
        "/data/current/2026第一次.txt",
        "/data/old/第一次.txt",
      ]),
    );
    const exact = await runFzfFilter("fzf", index, "'第一次");
    assert.deepEqual(new Set(exact.paths), new Set(initials.paths));

    const suffix = await runFzfFilter("fzf", index, ".pdf$");
    assert.deepEqual(suffix.paths, ["/data/2026/driver.pdf"]);
    const prefix = await runFzfFilter("fzf", index, "^2026");
    assert.deepEqual(new Set(prefix.paths), new Set(plainYear.paths));
    const parentIsNotSearchable = await runFzfFilter("fzf", index, "^data");
    assert.deepEqual(parentIsNotSearchable.paths, []);
  });
});

test("real fzf searches arbitrary Chinese names using initials and partial pinyin", async () => {
  await fixture(async (dir) => {
    const entries = [
      "/tmp/第二次.txt",
      "/tmp/第一次.txt",
      "/tmp/第三次",
      "/tmp/第三次/报告.txt",
      "/tmp/开发记录.md",
      "/tmp/电子技术.txt",
      "/tmp/第二次会议纪要.md",
      "/tmp/2026/第二次.txt",
    ];
    const raw = path.join(dir, "chinese-pinyin.pathlist");
    const staged = path.join(dir, "chinese-pinyin.nul.tmp");
    await writeFile(
      raw,
      entries.join(String.fromCharCode(0)) + String.fromCharCode(0),
    );
    await prepareIndex(raw, staged, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/tmp"],
    });
    await publishIndex(staged, dir);
    const index = path.join(dir, "index.nul");
    for (const query of [
      "dec",
      "derc",
      "d erc",
      "d er c",
      "di er ci",
      "dierci",
    ]) {
      const result = await runFzfFilter("fzf", index, query);
      assert.ok(
        result.paths.includes("/tmp/第二次.txt"),
        query + ": " + JSON.stringify(result.paths),
      );
      assert.equal(result.paths.includes("/tmp/第三次/报告.txt"), false, query);
    }
    for (const [query, expected] of [
      ["dyc", "第一次.txt"],
      ["dsc", "第三次"],
      ["dzjs", "电子技术.txt"],
      ["kfjl", "开发记录.md"],
    ]) {
      const result = await runFzfFilter("fzf", index, query);
      assert.ok(
        result.paths.some((p) => path.basename(p) === expected),
        query,
      );
    }
  });
});

test("common Chinese initials are not lost behind 150 loosely matching Latin filenames", async () => {
  await fixture(async (dir) => {
    const target = "/home/docs/第二次.txt";
    const entries = [
      ...Array.from(
        { length: 240 },
        (_, n) =>
          "/home/docs/decode-interface-package-" +
          String(n).padStart(4, "0") +
          ".txt",
      ),
      target,
    ];
    const raw = path.join(dir, "rank-pinyin-input");
    const staged = path.join(dir, "rank-pinyin-stage.nul.tmp");
    await writeFile(
      raw,
      entries.join(String.fromCharCode(0)) + String.fromCharCode(0),
    );
    await prepareIndex(raw, staged, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/home/docs"],
    });
    await publishIndex(staged, dir);
    const index = path.join(dir, "index.nul");
    for (const query of ["dec", "derc", "d erc", "d er c"]) {
      const result = await runFzfFilter("fzf", index, query);
      assert.ok(
        result.paths.includes(target),
        query + " missing Chinese result",
      );
      assert.ok(result.paths.length <= 150);
    }
  });
});

test("pinyin search still surfaces Chinese among 300 shorter prefix matches", async () => {
  await fixture(async (dir) => {
    const target = "/docs/第二次.txt";
    const entries = [
      ...Array.from({ length: 300 }, (_, n) => "/docs/dec" + n + ".c"),
      target,
    ];
    const raw = path.join(dir, "short-rank-input");
    const staged = path.join(dir, "short-rank-stage.tmp");
    await writeFile(
      raw,
      entries.join(String.fromCharCode(0)) + String.fromCharCode(0),
    );
    await prepareIndex(raw, staged, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/docs"],
    });
    await publishIndex(staged, dir);
    const result = await runFzfFilter(
      "fzf",
      path.join(dir, "index.nul"),
      "dec",
    );
    assert.ok(
      result.paths.includes(target),
      "Chinese matches must be visible even when 300 short ASCII prefixes rank higher",
    );
  });
});

test("slash-delimited fuzzy path search matches directory levels before the real fzf filename term", async () => {
  await fixture(async (dir) => {
    const entries = [
      "/sample/first",
      "/sample/first/second",
      "/sample/first/second/third",
      "/sample/first/second/third/fourth",
      "/sample/first/second/third/fourth.txt",
      "/sample/first/second/third/fourth/log.txt",
      "/sample/first/second/third/archive",
      "/sample/first/second/third/archive/fourth",
      "/sample/first/second/sibling/fourth",
      "/sample/第二次/第一次.txt",
      "/sample/第一次",
      "/sample/第一次/第二次",
      "/sample/第一次/第二次.txt",
      "/sample/第一次/第二次/报告.txt",
    ];
    const raw = path.join(dir, "path-level-input");
    const staged = path.join(dir, "path-level-staged.nul.tmp");
    await writeFile(raw, entries.join("\0") + "\0");
    await prepareIndex(raw, staged, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/sample"],
    });
    await publishIndex(staged, dir);
    const index = path.join(dir, "index.nul");
    const targets = [
      "/sample/first/second/third/fourth",
      "/sample/first/second/third/fourth.txt",
    ];
    for (const query of [
      "th/for",
      "third/fou",
      "fir/seco/th/four",
      "/fir/seco/th/four",
    ]) {
      const result = await runFzfFilter("fzf", index, query);
      assert.deepEqual(new Set(result.paths), new Set(targets), query);
      assert.equal(result.cancelled, false);
    }

    const directories = await runFzfFilter("fzf", index, "th/");
    assert.deepEqual(
      new Set(directories.paths),
      new Set([
        ...targets,
        "/sample/first/second/third/archive",
        "/sample/first/second/third/fourth/log.txt",
      ]),
    );
    const nonAdjacent = await runFzfFilter("fzf", index, "fir/th/four");
    assert.deepEqual(nonAdjacent.paths, []);

    const mixedPinyin = await runFzfFilter("fzf", index, "dyc/dec");
    assert.deepEqual(
      new Set(mixedPinyin.paths),
      new Set(["/sample/第一次/第二次", "/sample/第一次/第二次.txt"]),
    );
    const reversed = await runFzfFilter("fzf", index, "dec/dyc");
    assert.deepEqual(reversed.paths, ["/sample/第二次/第一次.txt"]);
    const pinyinDirectories = await runFzfFilter("fzf", index, "dyc/");
    assert.deepEqual(
      new Set(pinyinDirectories.paths),
      new Set(["/sample/第一次/第二次", "/sample/第一次/第二次.txt"]),
    );

    const plain = await runFzfFilter("fzf", index, "four");
    assert.ok(plain.paths.includes(targets[0]));
    assert.ok(
      plain.paths.includes("/sample/first/second/third/archive/fourth"),
    );
    const advanced = await runFzfFilter("fzf", index, "third/.txt$");
    assert.deepEqual(advanced.paths, [targets[1]]);
    const malformed = await assert.rejects(
      runFzfFilter("fzf", index, "third//fourth"),
      /empty directory levels/,
    );
    void malformed;
  });
});

test("smart-case and fzf extended operators on parent segments preserve real fzf leaf matches", async () => {
  await fixture(async (dir) => {
    const entries = [
      "/work/SrcCore/lib/driver.c",
      "/work/SrcCore/lib/driver.h",
      "/work/srccore/lib/driver.c",
      "/work/TestCore/lib/driver.c",
      "/work/SourceKit/lib/driver.c",
      "/work/第一次/第二次.txt",
      "/work/第二次/第一次.txt",
    ];
    const raw = path.join(dir, "fzf-extended-dir-records");
    const stage = path.join(dir, "fzf-extended-dir-stage.nul.tmp");
    await writeFile(raw, entries.join("\0") + "\0");
    await prepareIndex(raw, stage, {
      version: 3,
      count: entries.length,
      createdAt: new Date().toISOString(),
      roots: ["/work"],
    });
    await publishIndex(stage, dir);
    const index = path.join(dir, "index.nul");
    const lookup = async (query) =>
      new Set((await runFzfFilter("fzf", index, query)).paths);

    assert.deepEqual(
      await lookup("^Src/lib/.c$"),
      new Set(["/work/SrcCore/lib/driver.c"]),
    );
    assert.deepEqual(
      await lookup("^src/lib/.c$"),
      new Set(["/work/SrcCore/lib/driver.c", "/work/srccore/lib/driver.c"]),
    );
    assert.deepEqual(
      await lookup("!^test/lib/driver"),
      new Set([
        "/work/SrcCore/lib/driver.c",
        "/work/SrcCore/lib/driver.h",
        "/work/srccore/lib/driver.c",
        "/work/SourceKit/lib/driver.c",
      ]),
    );
    assert.deepEqual(
      await lookup("^src | ^test/lib/.c$"),
      new Set([
        "/work/SrcCore/lib/driver.c",
        "/work/srccore/lib/driver.c",
        "/work/TestCore/lib/driver.c",
      ]),
    );
    assert.deepEqual(
      await lookup("dyc/dec"),
      new Set(["/work/第一次/第二次.txt"]),
    );
    // 普通 basename 查询不得改成父目录搜索。
    assert.deepEqual(
      await lookup("^driver"),
      new Set([
        "/work/SrcCore/lib/driver.c",
        "/work/SrcCore/lib/driver.h",
        "/work/srccore/lib/driver.c",
        "/work/TestCore/lib/driver.c",
        "/work/SourceKit/lib/driver.c",
      ]),
    );
  });
});

test("native fzf matches hyphenated leaf names, leading slash and mixed pinyin levels", async () => {
  await fixture(async (dir) => {
    const paths = [
      "/sample/first/second/third/four-file.txt",
      "/sample/first/second/third/four-final.c",
      "/sample/first/second/archive/four-file.txt",
      "/sample/第一次/第二次/报告.txt",
    ];
    const raw = path.join(dir, "native-fzf.paths");
    const stage = path.join(dir, "native-fzf.stage");
    await writeFile(raw, paths.join("\0") + "\0");
    await prepareIndex(raw, stage, {
      version: 3, count: paths.length,
      createdAt: new Date().toISOString(), roots: ["/sample"],
    });
    await publishIndex(stage, dir);
    const index = path.join(dir, "index.nul");
    const find = async (query) => (await runFzfFilter("fzf", index, query)).paths;
    const expected = paths.slice(0, 2);
    assert.deepEqual(new Set(await find("fir/sec/thi/four-fi")), new Set(expected));
    assert.deepEqual(new Set(await find("/fir/sec/thi/four-fi")), new Set(expected));
    assert.deepEqual(await find("fir/thi/arc/four-fi"), []);
    assert.deepEqual(await find("dyc/dec/bg"), [paths[3]]);
    assert.deepEqual(await find("第一次/dec/报告"), [paths[3]]);
    assert.deepEqual(await find("dyc/第二次/bao"), [paths[3]]);
    assert.deepEqual(await find("DYc/dec/bg"), []);
  });
});

test("anchored fzf expressions preserve native filename suffixes and match pinyin aliases", async () => {
  await fixture(async (dir) => {
    const entries = ["/sample/第一次.txt", "/sample/第一次.md"];
    const raw = path.join(dir, "anchored.paths");
    const stage = path.join(dir, "anchored.stage");
    await writeFile(raw, entries.join("\0") + "\0");
    await prepareIndex(raw, stage, {
      version: 3, count: entries.length,
      createdAt: new Date().toISOString(), roots: ["/sample"],
    });
    await publishIndex(stage, dir);
    const index = path.join(dir, "index.nul");
    for (const query of [".txt$", "^dyc", "dyc$", "^dyc$", "'dyc"]) {
      const result = (await runFzfFilter("fzf", index, query)).paths;
      assert.ok(result.includes(entries[0]), query);
      assert.equal(new Set(result).size, result.length, query);
    }
    assert.deepEqual((await runFzfFilter("fzf", index, ".txt$")).paths, [entries[0]]);
  });
});

test("native fzf path query matches a top-level directory under hyphenated parent", async () => {
  await fixture(async (dir) => {
    const target = "/private/var/tmp/pathseek-standalone-fixture-abc/Shortcuts/";
    const raw = path.join(dir, "hyphen-root.paths");
    const stage = path.join(dir, "hyphen-root.stage");
    await writeFile(raw, target + "\0");
    await prepareIndex(raw, stage, {
      version: 3, count: 1, createdAt: new Date().toISOString(),
      roots: ["/private/var/tmp/pathseek-standalone-fixture-abc"],
    });
    await publishIndex(stage, dir);
    const file = path.join(dir, "index.nul");
    assert.deepEqual((await runFzfFilter("fzf", file, "pat/sho")).paths, [target]);
  });
});


test("scoped fzf search matches all descendant levels without leaking sibling paths", async () => {
  await fixture(async (dir) => {
    const entries = [
      "/projects/raypath/",
      "/projects/raypath/main.ts",
      "/projects/raypath/sub/source-file.ts",
      "/projects/raypath/sub/第一次.ts",
      "/projects/raypath/sub/deep/driver.js",
      "/projects/raypath-other/main.ts",
      "/projects/unrelated/sub/第一次.ts",
      "/projects/Symlinks/raypath/linked.ts",
    ];
    const raw = path.join(dir, "subtree.raw");
    const stage = path.join(dir, "subtree.stage");
    await writeFile(raw, entries.join("\0") + "\0");
    await prepareIndex(raw, stage, {
      version: 3,
      createdAt: new Date().toISOString(),
      count: entries.length,
      roots: ["/projects"],
    });
    await publishIndex(stage, dir);
    const index = path.join(dir, "index.nul");
    const run = async (query, root) =>
      (await runFzfFilter("fzf", index, query, undefined, 60_000, undefined, root)).paths;

    assert.deepEqual(
      new Set(await run(".ts$", "/projects/raypath")),
      new Set(entries.slice(1, 4)),
    );
    assert.deepEqual(await run("dyc", "/projects/raypath"), [entries[3]]);
    assert.deepEqual(await run("so file", "/projects/raypath"), [entries[2]]);
    assert.deepEqual(
      new Set(await run("", "/projects/raypath")),
      new Set(entries.slice(1, 5)),
    );
    assert.deepEqual(await run("main", "/projects/raypath-other"), [entries[5]]);
    assert.deepEqual(await run(".ts$", "/projects/Symlinks/raypath"), [entries[7]]);
    assert.deepEqual(await run("sub/deep/driv", "/projects/raypath"), [entries[4]]);

    // 不带子树限定时，原先的名称和连续层级规则不变。
    const ordinary = (await runFzfFilter("fzf", index, ".ts$")).paths;
    assert.ok(ordinary.includes(entries[1]));
    assert.ok(ordinary.includes(entries[5]));
    assert.deepEqual(
      new Set((await runFzfFilter("fzf", index, "raypath/.ts$")).paths),
      new Set([entries[1], entries[5]]),
    );
  });
});
