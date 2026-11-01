import { expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A refusal is loud only until somebody catches it: a library that has another road takes it and says nothing. BUN_JSC_aotCountsPath counts each where it is made.
const swallows = `const key = [114, 101, 113, 117, 105, 114, 101].map(code => String.fromCharCode(code)).join("");
let how;
try { how = typeof module[key]("node:fs").readFileSync; } catch { how = "the other road"; }
for (let i = 0; i < 3; i++) try { Array.prototype.push = function () {}; } catch {}
try { null.x; } catch {}
try { throw new Error("an error of the program"); } catch {}
class OfTheProgram extends Error {}
for (const words of ["the build failed", "compiled code is fast", "this executable is mine", "a compiled executable", "this test run is long", "compiled into bytecode", "pass --trim"])
  for (const Kind of [Error, OfTheProgram]) try { throw new Kind(words); } catch {}
console.log("SAY", how);`;

function refusals(directory: string) {
  const files = readdirSync(directory).filter(name => name.startsWith("counts."));
  const lines = files.flatMap(name => readFileSync(join(directory, name), "utf8").split("\n"));
  return lines
    .filter(line => line.includes("named:refused:"))
    .map(line => line.replace(/\S*\/(?=[^/ ]+:\d+)/g, ""))
    .sort();
}

test("an executable", async () => {
  using dir = tempDir("aot-refused-counts", { "entry.cjs": swallows });
  await run([bunExe(), "build", "--compile", "--aot", "entry.cjs", "--outfile", "compiled"], String(dir), bunEnv);
  const silent = await run([`${dir}/compiled`], String(dir), bunEnv);
  expect({ stdout: silent.stdout, stderr: silent.stderr, exitCode: silent.exitCode }).toEqual({
    stdout: "SAY the other road\n",
    stderr: "",
    exitCode: 0,
  });
  expect(refusals(String(dir))).toEqual([]);
  const counted = await run([`${dir}/compiled`], String(dir), { ...bunEnv, BUN_JSC_aotCountsPath: `${dir}/counts.%p` });
  expect({ stdout: counted.stdout, stderr: counted.stderr, exitCode: counted.exitCode }).toEqual({
    stdout: "SAY the other road\n",
    stderr: "",
    exitCode: 0,
  });
  expect(refusals(String(dir))).toEqual([
    "1\tnamed:refused:The module loader was not compiled into this executable because your code never uses it. To keep it, use it somewhere in your code. @ entry.cjs:3",
    "3\tnamed:refused:Cannot assign to Array.prototype.push because built-in objects are read-only in a compiled executable @ entry.cjs:4",
  ]);
});

test("a test run", async () => {
  using dir = tempDir("aot-refused-counts", {
    "swallows.test.cjs": `const { test } = require("bun:test");\ntest("passes", () => {\n${swallows}\n});`,
  });
  const env = {
    ...bunEnv,
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0",
    BUN_JSC_aotCountsPath: `${dir}/counts.%p`,
  };
  const counted = await run([bunExe(), "test", "--aot"], String(dir), env);
  expect(counted.exitCode).toBe(0);
  expect(counted.stdout).toContain("SAY the other road");
  const lines = refusals(String(dir));
  expect(
    lines
      .filter(line => line.includes("The module loader was not compiled"))
      .map(line => line.slice(line.indexOf(" @ "))),
  ).toEqual([" @ swallows.test.cjs:5"]);
});

// A realm a test file: what an early file swallowed still stands at the end of the run.
test("a test run with --isolate", async () => {
  const quiet = (n: number) => `const { test } = require("bun:test");\ntest("quiet ${n}", () => {});`;
  using dir = tempDir("aot-refused-counts", {
    "a.test.cjs": `const { test } = require("bun:test");\ntest("passes", () => {\n${swallows}\n});`,
    "b.test.cjs": quiet(1),
    "c.test.cjs": quiet(2),
  });
  const counted = await run([bunExe(), "test", "--aot", "--isolate"], String(dir), {
    ...bunEnv,
    BUN_JSC_aotCountsPath: `${dir}/counts.%p`,
  });
  expect(counted.exitCode).toBe(0);
  const lines = refusals(String(dir)).filter(line => line.includes("The module loader was not compiled"));
  expect(lines.map(line => line.slice(line.indexOf(" @ ")))).toEqual([" @ a.test.cjs:5"]);
});

test("plain Bun writes no such line", async () => {
  using dir = tempDir("aot-refused-counts", {
    "entry.cjs": `try { throw new Error("this executable, says the program"); } catch {}\nconsole.log("SAY ran");`,
  });
  const plain = await run([bunExe(), "entry.cjs"], String(dir), {
    ...bunEnv,
    BUN_JSC_aotCountsPath: `${dir}/counts.%p`,
  });
  expect(plain.stdout).toBe("SAY ran\n");
  expect(refusals(String(dir))).toEqual([]);
});
