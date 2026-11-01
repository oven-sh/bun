import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` compiles what the test files import as one program and the test files as programs above it. Objects, classes,
// closures, errors and modules go from one to the other here, both ways. The files are test files only in the copy that is run.
const folder = join(import.meta.dir, "test-run-over-a-shared-program");
const files = Object.fromEntries(
  readdirSync(folder).map(name => [name.replace(".fixture.ts", ".test.ts"), readFileSync(join(folder, name), "utf8")]),
);

async function runTests(directory: string, ...flags: string[]) {
  // Not CI: the plain run writes the snapshot that the compiled run is held to.
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
  // With a sanitizer, on a busy machine, the slowest of the tests has passed the five seconds that a test has.
  const command = [bunExe(), "test", "--timeout=60000", "--preload", "./pre.ts", ...flags];
  const { stderr, exitCode } = await run(command, directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail|skip)\) (.*?)(?: \[.*\])?$/gm)].map(
    match => `${match[1]} ${match[2]}`,
  );
  return { results: results.sort(), exitCode };
}

test("test files above a shared program run as under plain bun test", async () => {
  using dir = tempDir("aot-test-run-over-a-shared-program", files);
  const plain = await runTests(String(dir));
  expect(plain.results.length).toBeGreaterThan(100);
  expect(plain.results.filter(result => !result.startsWith("pass "))).toEqual([]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 120_000);
