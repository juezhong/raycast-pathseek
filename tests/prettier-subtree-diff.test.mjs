import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import prettier from "prettier";

test("TEMP Prettier check for subtree implementation", async () => {
  const file = "src/lib/subtree-search.ts";
  const raw = await readFile(file, "utf8");
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(raw, { ...config, filepath: file });
  const diff = spawnSync("diff", ["-u", file, "-"], {
    encoding: "utf8", input: formatted, maxBuffer: 1024 * 1024,
  });
  console.log("PRETTIER-SUBTREE-DIFF-START");
  console.log(diff.stdout || "(identical)");
  console.log("PRETTIER-SUBTREE-DIFF-END");
});
