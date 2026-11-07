import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Two runs at once in one folder share nothing that either writes.
const files = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "src/names.js": `export const names = ["child_process", "zlib", "http", "readline", "worker_threads", "vm", "crypto", "stream", "util", "os", "events"];`,
  "library.test.js": `import { test } from "bun:test";
import { names } from "./src/names.js";
test("modules of Bun under names that are put together", () => {
  console.log("kinds", ...names.map(name => typeof require("node:" + name)));
});`,
  "other.test.js": `import { expect, test } from "bun:test";
import { names } from "./src/names.js";
test("another file", () => { expect(names.length).toBe(11); });`,
};

const asOneProgram = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" };

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const command = [bunExe(), "test", "--isolate", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { printed: printed.sort(), results: results.sort(), exitCode };
}

test("two runs at once in one folder, and neither writes into the project", async () => {
  using dir = tempDir("aot-test-runs-at-once", files);
  const plain = await runTests(String(dir), {});
  expect(plain.results).toEqual(["pass another file", "pass modules of Bun under names that are put together"]);
  expect(plain.exitCode).toBe(0);
  const runs = [1, 2].map(() => runTests(String(dir), asOneProgram, "--aot"));
  expect(await Promise.all(runs)).toEqual([plain, plain]);
  expect(existsSync(join(String(dir), "node_modules"))).toBe(false);
}, 240_000);
