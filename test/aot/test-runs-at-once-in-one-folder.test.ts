import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A build that does not see the test files has an entry point that stands in for them. It used to be a file in node_modules/.cache
// of the project, and it had more than one text: the lowest layer's names every module of Bun's own code, an upper layer's names none.
// Of two runs at once in one folder, one built its lowest layer from what the other had written for an upper layer. That layer held
// none of Bun's own code, and the run ended with "Cannot load 'node:child_process': it isn't in this executable" or aborted.
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

const forms: Record<string, Record<string, string>> = {
  "in layers": { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" },
  "in layers that are told what is named": {
    BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
    BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
  },
  "with test files from disk": { BUN_AOT_TEST_FILES_FROM_DISK: "1" },
  "with test files from disk that say what they name": {
    BUN_AOT_TEST_FILES_FROM_DISK: "1",
    BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
  },
};

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const command = [bunExe(), "test", "--isolate", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { printed: printed.sort(), results: results.sort(), exitCode };
}

for (const [form, env] of Object.entries(forms)) {
  test(`a run ${form} writes nothing into the project`, async () => {
    using dir = tempDir("aot-test-run-writes-nothing", files);
    const plain = await runTests(String(dir), {});
    expect(plain.results).toEqual(["pass another file", "pass modules of Bun under names that are put together"]);
    expect(plain.exitCode).toBe(0);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
    expect(existsSync(join(String(dir), "node_modules"))).toBe(false);
  }, 120_000);

  test(`a run ${form} where node_modules/.cache is no folder`, async () => {
    using dir = tempDir("aot-test-run-cache-is-a-file", { ...files, "node_modules/.cache": "" });
    const plain = await runTests(String(dir), {});
    expect(plain.exitCode).toBe(0);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  }, 120_000);
}

test("a run in layers beside a run that keeps writing an upper layer's text where the file was", async () => {
  using dir = tempDir("aot-test-run-beside-a-writer", {
    ...files,
    // What stood in for the test files over an upper layer, written as a run wrote it: whole, under another name, renamed into place.
    "node_modules/.cache/upper.ts": `const other = process.argv.at(-1)!;
if (other === "\\0never") {
  await import(other);
  require(other);
}
`,
    "node_modules/.cache/write.cjs": `const { copyFileSync, renameSync } = require("node:fs");
for (;;) {
  copyFileSync(__dirname + "/upper.ts", __dirname + "/unfinished.ts");
  renameSync(__dirname + "/unfinished.ts", __dirname + "/bun-test-files-from-disk.ts");
}`,
  });
  const plain = await runTests(String(dir), {});
  expect(plain.exitCode).toBe(0);
  await using writer = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "node_modules/.cache/write.cjs")],
    env: bunEnv,
    stdout: "ignore",
    stderr: "inherit",
  });
  expect(await runTests(String(dir), forms["in layers"], "--aot")).toEqual(plain);
  expect(writer.exitCode).toBe(null);
}, 120_000);

test("three runs in layers at once in one folder", async () => {
  using dir = tempDir("aot-test-runs-at-once", files);
  const plain = await runTests(String(dir), {});
  expect(plain.exitCode).toBe(0);
  const runs = [1, 2, 3].map(() => runTests(String(dir), forms["in layers"], "--aot"));
  expect(await Promise.all(runs)).toEqual([plain, plain, plain]);
}, 240_000);
