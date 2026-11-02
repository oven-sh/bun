import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A layered test run has three images in one realm: the packages with Bun's library, what else the test files import, and the test files.
// Here classes, closures, objects with typed fields, errors, iterators, proxies, modules and the library's own state go from each to the others, each body seven times.
// A check prints what it saw, so a wrong value shows where no `expect` asks for it. The files are packages and test files only in the copy that is run.
const folder = join(import.meta.dir, "three-layers");
const files = Object.fromEntries(
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .map(path => [
      path
        .slice(folder.length + 1)
        .replaceAll("\\", "/")
        .replace(/^packages\//, "node_modules/")
        .replace(/^tests\/(.*)\.fixture\./, "test/$1.test."),
      readFileSync(path, "utf8"),
    ]),
);

async function seenIn(words: string | undefined, flags: string[] = [], more: Record<string, string> = {}) {
  using dir = tempDir("aot-three-layers", files);
  // Not CI: each run writes the snapshot that it is held to.
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: words, ...more };
  // Five runs at once: on a busy machine a check that waits for a file watcher has passed the five seconds that a test has.
  const command = [bunExe(), "test", "--isolate", "--timeout=60000", ...flags];
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("RESULT|"));
  return { seen: seen.sort(), failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)), exitCode };
}

test("three layers answer as one program and as plain bun test", async () => {
  const [plain, one, layers, smallPieces, projectInTwo, newCheckers, validated] = await Promise.all([
    seenIn(undefined),
    seenIn("TestRunLayers:0", ["--aot"]),
    seenIn(undefined, ["--aot"]),
    seenIn("TestRunLayers:2,TestRunPartFiles:8", ["--aot"]),
    // The files of the project are two programs, one above the other.
    seenIn("TestRunLayers:3,TestRunPartFiles:8", ["--aot"]),
    // Each program is lowered in three passes, each with a type checker that knows nothing yet.
    seenIn("TestRunLayers:2,TestRunPartFiles:8,TestRunCheckerPasses:3", ["--aot"]),
    // The run time checks its own tables at the end of each collection and wherever it files an answer: a wrong row stops the run where no value shows it yet.
    seenIn(undefined, ["--aot"], { BUN_JSC_validateAOTRuntime: "1" }),
  ]);
  expect(plain.seen.length).toBeGreaterThan(320);
  expect(plain.failed).toEqual([]);
  expect(one).toEqual(plain);
  expect(layers).toEqual(plain);
  expect(smallPieces).toEqual(plain);
  expect(projectInTwo).toEqual(plain);
  expect(newCheckers).toEqual(plain);
  expect(validated).toEqual(plain);
}, 240_000);
