import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import prettier from "prettier";

test("TEMP: print Prettier source diff for generated code review", async () => {
  const file = "src/search-files.tsx";
  const raw = await readFile(file, "utf8");
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(raw, { ...config, filepath: file });
  const diff = spawnSync("diff", ["-u", file, "-"], {
    encoding: "utf8",
    input: formatted,
    maxBuffer: 1024 * 1024,
  });
  console.log("PRETTIER-DIFF-START");
  console.log(diff.stdout || "(identical)");
  console.log("PRETTIER-DIFF-END");
});
