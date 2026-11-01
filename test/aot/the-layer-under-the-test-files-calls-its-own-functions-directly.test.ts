import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runsWholeGrids } from "./harness/ways";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// BUN_AOT_TESTS_NAME_WHAT_THEY_USE: the layer that the test files stand on is told what they name, so a call between two of its own files is the executable's: direct.
// Two things that large suites have used to open every export of every file all the same: a helper that hands spyOn an object and a name from somewhere, and a file of
// the program that loads a module under a name that it puts together and keeps what it gets. Neither reaches `callee`: no test names it, and nobody holds its module.
// The layers are built as `bun test --aot` builds them, and the compiler's map says which operations a function is made of.
const files = {
  "callee.ts": `
    export function callee(value: number) { return value + 1; }`,
  "caller.ts": `
    import { callee } from "./callee.ts";
    export function caller(value: number) { return callee(value) * 2; }`,
  "loads.ts": `
    const loaded = new Map<string, unknown>();
    export function load(name: string) {
      let found = loaded.get(name);
      if (found === undefined) {
        found = require(name);
        loaded.set(name, found);
      }
      return found;
    }`,
  "watch.ts": `
    import { spyOn } from "bun:test";
    export function watch(object: object, name: string) { return spyOn(object as Record<string, () => unknown>, name); }`,
  "a.test.ts": `
    import { expect, test } from "bun:test";
    import { caller } from "./caller.ts";
    import { load } from "./loads.ts";
    import { watch } from "./watch.ts";
    test("a", () => {
      const holder = { read() { return 1; } };
      watch(holder, ["re", "ad"].join("")).mockReturnValue(2);
      expect(holder.read()).toBe(2);
      expect(caller(1)).toBe(4);
      expect(typeof (load(["node", "path"].join(":")) as { join: unknown }).join).toBe("function");
    });`,
};
const env = {
  ...bunEnv,
  BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
  BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
};

test("a call of a function that no test names is no read of a variable", async () => {
  using dir = tempDir("aot-the-layer-calls-its-own-functions-directly", files);
  const at = (name: string) => join(String(dir), name);
  const build = async (graph: string, part: string, below: number[], more: Record<string, string>) => {
    writeFileSync(at(graph), at("a.test.ts") + "\0");
    const descriptor = openSync(at(graph), "r+");
    try {
      await using builder = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", "--isolate", `--aot-build-test-part=${part}`],
        cwd: String(dir),
        env: { ...env, ...more },
        stdio: ["ignore", "pipe", "pipe", descriptor, ...below],
      });
      const [stderr, exitCode] = await Promise.all([builder.stderr.text(), builder.exited]);
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    } finally {
      closeSync(descriptor);
    }
  };
  await build("packages", "3,shared,packages", [], {});
  // As the run hands it over: the build above lays the headers of its texts into the lowest program.
  const packages = openSync(at("packages"), "r+");
  try {
    await build("shared", "3,shared,below:4", [packages], { BUN_JSC_aotMapFilePath: at("map") });
  } finally {
    closeSync(packages);
  }
  const lines = readFileSync(at("map"), "utf8").split("\n");
  const operations: string[] = [];
  lines.forEach((line, index) => {
    const [kind, , , , , , , name] = line.split("\t");
    if (kind === "F" && name === "caller" && line.includes("caller.ts"))
      operations.push(...lines[index + 1].split("\t"));
  });
  expect(operations).toContain("O");
  expect(operations.filter(word => /^(GetModuleVariable|Call|CheckInitialized)\+?$/.test(word))).toEqual([]);
}, 120_000);

// A whole run over layers, which has never been the witness of a fault: the benches run it.
if (runsWholeGrids)
  test("the run passes", async () => {
    using dir = tempDir("aot-the-layer-calls-its-own-functions-directly-run", files);
    await using run = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", "--isolate"],
      cwd: String(dir),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }, 120_000);
