import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "path";

test("coverage crash", () => {
  using dir = tempDir("cov", {
    "demo.test.ts": `class Y {
  #hello
}`,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});

test("lcov coverage reporter", () => {
  using dir = tempDir("cov", {
    "demo2.ts": `
import { Y } from "./demo1";

export function covered() {
  // this function IS covered
  return Y;
}

export function uncovered() {
  // this function is not covered
  return 42;
}

covered();
`,
    "demo1.ts": `
export class Y {
#hello;
};
    `,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "lcov", "./demo2.ts"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["inherit", "inherit", "inherit"],
  });
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
  expect(normalizeBunSnapshot(readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8"), dir)).toMatchSnapshot(
    "lcov-coverage-reporter-output",
  );
});

test("coverage excludes node_modules directory", () => {
  using dir = tempDir("cov", {
    "node_modules/pi/index.js": `
    export const pi = 3.14;
    `,
    "demo.test.ts": `
    import { pi } from 'pi';
    console.log(pi);
    `,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  expect(result.stderr.toString("utf-8")).toContain("demo.test.ts");
  expect(result.stderr.toString("utf-8")).not.toContain("node_modules");
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});

test("coveragePathIgnorePatterns - single pattern string", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

test("should call both functions", () => {
  expect(includeMe()).toBe("included");
  expect(ignoreMe()).toBe("ignored");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call both functions
---------------|---------|---------|-------------------
File           | % Funcs | % Lines | Uncovered Line #s
---------------|---------|---------|-------------------
All files      |  100.00 |  100.00 |
 include-me.ts |  100.00 |  100.00 | 
 test.test.ts  |  100.00 |  100.00 | 
---------------|---------|---------|-------------------

 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - partial coverage without nan", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}

export function neverCalled() {
  return "never called";
}
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

test("should call only some functions", () => {
  expect(includeMe()).toBe("included");
  expect(ignoreMe()).toBe("ignored");
  // Note: neverCalled() is not called, so coverage should be partial
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call only some functions
---------------|---------|---------|-------------------
File           | % Funcs | % Lines | Uncovered Line #s
---------------|---------|---------|-------------------
All files      |   75.00 |   83.33 |
 include-me.ts |   50.00 |   66.67 | 6
 test.test.ts  |  100.00 |  100.00 | 
---------------|---------|---------|-------------------

 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - array of patterns", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["utils/**", "*.config.ts"]
coverageSkipTestFiles = false
`,
    "src/main.ts": `
export function main() {
  return "main";
}
`,
    "utils/helper.ts": `
export function helper() {
  return "helper";
}
`,
    "build.config.ts": `
export const config = { build: true };
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { main } from "./src/main";
import { helper } from "./utils/helper";
import { config } from "./build.config";

test("should call all functions", () => {
  expect(main()).toBe("main");
  expect(helper()).toBe("helper");
  expect(config.build).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call all functions
--------------|---------|---------|-------------------
File          | % Funcs | % Lines | Uncovered Line #s
--------------|---------|---------|-------------------
All files     |  100.00 |  100.00 |
 src/main.ts  |  100.00 |  100.00 | 
 test.test.ts |  100.00 |  100.00 | 
--------------|---------|---------|-------------------

 1 pass
 0 fail
 3 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - glob patterns", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["**/*.spec.ts", "test-utils/**"]
coverageSkipTestFiles = false
`,
    "src/feature.ts": `
export function feature() {
  return "feature";
}
`,
    "src/feature.spec.ts": `
export function featureSpec() {
  return "spec";
}
`,
    "test-utils/index.ts": `
export function testUtils() {
  return "utils";
}
`,
    "main.test.ts": `
import { test, expect } from "bun:test";
import { feature } from "./src/feature";
import { featureSpec } from "./src/feature.spec";
import { testUtils } from "./test-utils";

test("should call all functions", () => {
  expect(feature()).toBe("feature");
  expect(featureSpec()).toBe("spec");
  expect(testUtils()).toBe("utils");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"main.test.ts:
(pass) should call all functions

src/feature.spec.ts:
----------------|---------|---------|-------------------
File            | % Funcs | % Lines | Uncovered Line #s
----------------|---------|---------|-------------------
All files       |  100.00 |  100.00 |
 main.test.ts   |  100.00 |  100.00 | 
 src/feature.ts |  100.00 |  100.00 | 
----------------|---------|---------|-------------------

 1 pass
 0 fail
 3 expect() calls
Ran 1 test across 2 files."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - lcov reporter", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

test("should call both functions", () => {
  expect(includeMe()).toBe("included");
  expect(ignoreMe()).toBe("ignored");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "lcov"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let lcovContent = readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8");
  // Normalize LCOV content for cross-platform consistency
  lcovContent = normalizeBunSnapshot(lcovContent, dir);

  expect(lcovContent).toMatchInlineSnapshot(`
"TN:
SF:include-me.ts
FNF:1
FNH:1
DA:2,11
DA:3,17
LF:2
LH:2
end_of_record
TN:
SF:test.test.ts
FNF:1
FNH:1
DA:2,40
DA:3,41
DA:4,39
DA:6,42
DA:7,39
DA:8,36
DA:9,2
LF:7
LH:7
end_of_record"
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - invalid config type", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = 123
coverageSkipTestFiles = false
`,
    "test.test.ts": `
import { test, expect } from "bun:test";

test("should pass", () => {
  expect(true).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize error output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"3 | coveragePathIgnorePatterns = 123
                                 ^
error: coveragePathIgnorePatterns must be a string or array of strings
    at <dir>/bunfig.toml:3:30

Invalid Bunfig: failed to load bunfig"
`);
  expect(result.exitCode).toBe(1);
});

test("coveragePathIgnorePatterns - invalid array item", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["valid-pattern", 123]
coverageSkipTestFiles = false
`,
    "test.test.ts": `
import { test, expect } from "bun:test";

test("should pass", () => {
  expect(true).toBe(true);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize error output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"3 | coveragePathIgnorePatterns = ["valid-pattern", 123]
                                                   ^
error: coveragePathIgnorePatterns array must contain only strings
    at <dir>/bunfig.toml:3:48

Invalid Bunfig: failed to load bunfig"
`);
  expect(result.exitCode).toBe(1);
});

test("coveragePathIgnorePatterns - empty array", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = []
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";

test("should call function", () => {
  expect(includeMe()).toBe("included");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call function
---------------|---------|---------|-------------------
File           | % Funcs | % Lines | Uncovered Line #s
---------------|---------|---------|-------------------
All files      |  100.00 |  100.00 |
 include-me.ts |  100.00 |  100.00 | 
 test.test.ts  |  100.00 |  100.00 | 
---------------|---------|---------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - ignore all files", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "**"
coverageSkipTestFiles = false
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
`,
    "test.test.ts": `
import { test, expect } from "bun:test";
import { includeMe } from "./include-me";

test("should call function", () => {
  expect(includeMe()).toBe("included");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });

  let stderr = result.stderr.toString("utf-8");
  // Normalize output for cross-platform consistency
  stderr = normalizeBunSnapshot(stderr, dir);

  expect(stderr).toMatchInlineSnapshot(`
"test.test.ts:
(pass) should call function
-----------|---------|---------|-------------------
File       | % Funcs | % Lines | Uncovered Line #s
-----------|---------|---------|-------------------
All files  |    0.00 |    0.00 |
-----------|---------|---------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/39930
// One worker executes count(), the other only imports the module. The
// import-only worker reports the unexecuted function's whole line range
// (blank line 5 included) as executable with zero hits. The merge must not
// let that over-approximation mark the fully executed function as
// partially covered.
test("--parallel merges line coverage across workers", async () => {
  using dir = tempDir("cov-parallel-merge", {
    "subject.ts": `await Bun.sleep(100);

export default function count(values: string[]) {
  const count = values.length;

  return count;
}
`,
    "execute.test.ts": `
import { expect, test } from "bun:test";
import count from "./subject.ts";

test("executes the function", () => {
  expect(count(["first", "second"])).toBe(2);
});
`,
    "importOnly.test.ts": `
import { expect, test } from "bun:test";
import count from "./subject.ts";

test("only imports the function", () => {
  expect(typeof count).toBe("function");
});
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--parallel=2"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => r.includes("SF:subject.ts"));
  expect(record).toBeDefined();
  // Blank line 5 is only "executable" in the worker that never ran count().
  expect(record).not.toContain("DA:5,");
  expect(record).toMatch(/LF:4\nLH:4\n/);

  expect(stderr).toMatch(/ subject\.ts +\| +100\.00 +\| +100\.00 +\| +\n/);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/40586
// Each worker executes a different function of the same module; the merged
// report must count a function as covered if any worker ran it.
test("--parallel merges function coverage across workers", async () => {
  // Each test file waits at import time until the other has started, so the
  // two can only make progress in two different workers.
  const rendezvous = (me: string, other: string) => `
await Bun.write("${me}.started", "");
for (const deadline = Date.now() + 60_000; !(await Bun.file("${other}.started").exists()); ) {
  if (Date.now() > deadline) throw new Error("${other} never started in another worker");
  await Bun.sleep(5);
}
`;
  using dir = tempDir("cov-parallel-fn-merge", {
    "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\ncoverageThreshold = { lines = 1.0, functions = 1.0 }\n`,
    "subject.ts": `export function first() {
  return 1;
}
export function second() {
  return 2;
}
`,
    "first.test.ts": `${rendezvous("first", "second")}
import { expect, test } from "bun:test";
import { first } from "./subject.ts";

test("calls first", () => {
  expect(first()).toBe(1);
});
`,
    "second.test.ts": `${rendezvous("second", "first")}
import { expect, test } from "bun:test";
import { second } from "./subject.ts";

test("calls second", () => {
  expect(second()).toBe(2);
});
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--parallel=2"],
    env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("2 pass");
  expect(stderr).toMatch(/ subject\.ts +\| +100\.00 +\| +100\.00 +\| +\n/);
  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => r.includes("SF:subject.ts"));
  expect(record).toMatch(/FNF:2\nFNH:2\n/);
  expect(exitCode).toBe(0);
});

type Row = { functions: string; lines: string; uncovered: string };
// The text reporter's row and the lcov record of every file in the report.
async function run(fixture: Record<string, string>, args: string[], env: Record<string, string> = {}) {
  using dir = tempDir("cov", fixture);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", ...args],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(stderr);
  const rows: Record<string, Row> = {};
  for (const line of stderr.split("\n")) {
    const [file, functions, lines, uncovered] = line.split("|").map(column => column.trim());
    if (uncovered !== undefined) rows[file] = { functions, lines, uncovered };
  }
  const lcov: Record<string, string> = {};
  for (const record of readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8").split("end_of_record")) {
    const file = record.match(/^SF:(.+)$/m)?.[1];
    if (file) lcov[file] = record;
  }
  return { rows, lcov, stdout };
}

// JSC records coverage per SourceProvider, and a file has one for each time
// it is loaded. Each case has a subject file of its own. Where a case loads
// its subject twice, one load runs the `if` branch and the other runs the
// `return` after it.
describe("a file loaded more than once counts every load", () => {
  const esm = `export function covered(n: number): number {
  if (n > 5) {
    return n * 2;
  }
  return n + 1;
}
`;
  const cjs = `exports.covered = function covered(n) {
  if (n > 5) {
    return n * 2;
  }
  return n + 1;
};
`;
  const compiledText =
    Buffer.alloc(12, "\n").toString() +
    "exports.other = function other(n) {\n  if (n > 5) {\n    return 1;\n  }\n  return 2;\n};\nexports.other(1);\n";

  const files = {
    "host-and-graph.ts": esm,
    "two-graphs.ts": esm,
    "cjs-host-and-graph.cjs": cjs,
    "query-strings.ts": esm,
    "overlapping-imports.ts": esm,
    "require-cache.cjs": cjs,
    // https://github.com/oven-sh/bun/issues/35345
    "issue-35345.ts": `export const MODULE_SCOPE = "evaluated";

export function fnA(x: number): number {
  const a = x + 1;
  return a * 2;
}

export function fnB(x: number): number {
  const b = x + 10;
  return b * 3;
}
`,
    "functions.ts": `export function first() {
  return 1;
}
export function second() {
  return 2;
}
export function third() {
  return 3;
}
`,
    "cjs-graph-alone.cjs": cjs,
    "compile-target.cjs": cjs,
    "compile.cjs": `
const Module = require("node:module");
exports.compileAs = (filename, text) => {
  const module = new Module(filename);
  module.filename = filename;
  module._compile(text, filename);
  return module.exports;
};
`,
    // With ONE_LOAD=1 the last three cases leave out the load under test, to compare against.
    "loads.test.ts": `
import { expect, test } from "bun:test";
import { codeCoverageForFile } from "bun:jsc";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { covered as hostAndGraph } from "./host-and-graph.ts";
import { first } from "./functions.ts";
const cjsHostAndGraph = require("./cjs-host-and-graph.cjs");
const compileTarget = require("./compile-target.cjs");

const oneLoad = !!process.env.ONE_LOAD;
// codeCoverageForFile() takes the path as the module loader spells it.
const here = name => join(import.meta.dir, name);

test("host-and-graph.ts", async () => {
  expect(hostAndGraph(1)).toBe(2);
  const hostAlone = codeCoverageForFile(here("host-and-graph.ts"), false);
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("host-and-graph.ts"));
  expect(graph.run(() => subject.covered(10))).toBe(20);
  console.log(JSON.stringify({ hostAlone, both: codeCoverageForFile(here("host-and-graph.ts"), false) }));
  expect(() => codeCoverageForFile(here("never-loaded.ts"), false)).toThrow("No source for file");
});

test("two-graphs.ts", async () => {
  using a = new Bun.ModuleGraph({});
  using b = new Bun.ModuleGraph({});
  const inA = await a.import(here("two-graphs.ts"));
  const inB = await b.import(here("two-graphs.ts"));
  expect(a.run(() => inA.covered(10))).toBe(20);
  expect(b.run(() => inB.covered(1))).toBe(2);
});

test("cjs-host-and-graph.cjs", async () => {
  expect(cjsHostAndGraph.covered(1)).toBe(2);
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("cjs-host-and-graph.cjs"));
  expect(graph.run(() => subject.covered(10))).toBe(20);
});

test("query-strings.ts", async () => {
  const a = await import("./query-strings.ts?a");
  const b = await import("./query-strings.ts?b");
  expect(a.covered).not.toBe(b.covered);
  expect(a.covered(10)).toBe(20);
  expect(b.covered(1)).toBe(2);
});

test("overlapping-imports.ts", async () => {
  const [a, b] = await Promise.all([import("./overlapping-imports.ts"), import("./overlapping-imports.ts")]);
  expect(a).toBe(b);
  expect(a.covered(10)).toBe(20);
  expect(b.covered(1)).toBe(2);
});

test("issue-35345.ts", async () => {
  const first = await import("./issue-35345.ts?bun-spec=1");
  expect(first.fnA(1)).toBe(4);
  const second = await import("./issue-35345.ts?bun-spec=2");
  expect(second.fnB(1)).toBe(33);
});

test("require-cache.cjs", () => {
  const a = require("./require-cache.cjs");
  delete require.cache[require.resolve("./require-cache.cjs")];
  const b = require("./require-cache.cjs");
  expect(a.covered).not.toBe(b.covered);
  expect(a.covered(10)).toBe(20);
  expect(b.covered(1)).toBe(2);
});

test("functions.ts", async () => {
  expect(first()).toBe(1);
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("functions.ts"));
  expect(graph.run(() => subject.second())).toBe(2);
});

test("cjs-graph-alone.cjs", async () => {
  if (oneLoad) {
    expect(require("./cjs-graph-alone.cjs").covered(10)).toBe(20);
    return;
  }
  using graph = new Bun.ModuleGraph({});
  const subject = await graph.import(here("cjs-graph-alone.cjs"));
  expect(graph.run(() => subject.covered(10))).toBe(20);
});

test("compile-target.cjs", async () => {
  expect(compileTarget.covered(1)).toBe(2);
  if (oneLoad) return;
  using graph = new Bun.ModuleGraph({});
  const { compileAs } = await graph.import(here("compile.cjs"));
  const compiled = graph.run(() => compileAs(here("compile-target.cjs"), ${JSON.stringify(compiledText)}));
  expect(compiled.other(10)).toBe(1);
});

test("changed.ts", async () => {
  if (!oneLoad) {
    writeFileSync(here("changed.ts"), ${JSON.stringify(esm)});
    const before = await import("./changed.ts?before");
    expect(before.covered(10)).toBe(20);
  }
  writeFileSync(here("changed.ts"), ${JSON.stringify("export function unused() {\n  return 0;\n}\n" + esm)});
  const after = await import("./changed.ts?after");
  expect(after.covered(1)).toBe(2);
});
`,
  };

  // A plugin's onLoad result gets a new SourceProvider for every load, under --isolate too.
  // https://github.com/oven-sh/bun/issues/40386
  const pluginFiles = {
    "bunfig.toml": `[test]\npreload = ["./plugin.ts"]\n`,
    "plugin.ts": `
import { plugin } from "bun";

plugin({
  name: "passthrough",
  setup(build) {
    build.onLoad({ filter: /plugin-loaded\\.ts$/ }, async ({ path }) => {
      return { contents: await Bun.file(path).text(), loader: "ts" };
    });
  },
});
`,
    "plugin-loaded.ts": esm,
    "a.test.ts": `
import { expect, test } from "bun:test";
import { covered } from "./plugin-loaded.ts";

test("a", () => {
  expect(covered(10)).toBe(20);
});
`,
    "b.test.ts": `
import { expect, test } from "bun:test";
import { covered } from "./plugin-loaded.ts";

test("b", () => {
  expect(covered(1)).toBe(2);
});
`,
  };

  let loaded: Awaited<ReturnType<typeof run>>;
  let oneLoad: Awaited<ReturnType<typeof run>>;
  let pluginUnderIsolate: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    [loaded, oneLoad, pluginUnderIsolate] = await Promise.all([
      run(files, ["./loads.test.ts"]),
      run(files, ["./loads.test.ts"], { ONE_LOAD: "1" }),
      run(pluginFiles, ["--isolate", "./a.test.ts", "./b.test.ts"]),
    ]);
  });

  const fullyCovered: Row = { functions: "100.00", lines: "100.00", uncovered: "" };

  describe.each([
    ["by the host and by a Bun.ModuleGraph", "host-and-graph.ts"],
    ["by two Bun.ModuleGraphs", "two-graphs.ts"],
    ["CommonJS, by the host and by a Bun.ModuleGraph", "cjs-host-and-graph.cjs"],
    ["under two query strings", "query-strings.ts"],
    ["by two overlapping import()s", "overlapping-imports.ts"],
    ["again after a require.cache delete", "require-cache.cjs"],
  ])("%s", (_, file) => {
    test("is fully covered", () => {
      expect(loaded.rows[file]).toEqual(fullyCovered);
    });
  });

  test("from a plugin's onLoad, by two test files under --isolate", () => {
    expect(pluginUnderIsolate.rows["plugin-loaded.ts"]).toEqual(fullyCovered);
  });

  test("lcov has the functions and the lines of both loads (#35345)", () => {
    expect(loaded.lcov["issue-35345.ts"]).toMatch(/FNF:2\nFNH:2\n/);
    expect(loaded.lcov["issue-35345.ts"]).not.toMatch(/DA:\d+,0\n/);
  });

  test("a function counts if any load ran it, and not if none did", () => {
    // The host runs first(), a graph runs second(). third() spans lines 7 to 9.
    expect(loaded.rows["functions.ts"]).toEqual({
      functions: "66.67",
      lines: expect.any(String),
      uncovered: expect.stringMatching(/^[789](-[89])?$/),
    });
  });

  test("CommonJS, by a Bun.ModuleGraph alone, reports what the host alone reports", () => {
    expect(oneLoad.rows["cjs-graph-alone.cjs"].uncovered).not.toBe("");
    expect(loaded.rows["cjs-graph-alone.cjs"]).toEqual(oneLoad.rows["cjs-graph-alone.cjs"]);
  });

  // module._compile() names a file and brings a text of its own, which no
  // line table describes. In a graph it runs under a wrapping SourceProvider,
  // like the graph's load of the file itself, and must not count as one.
  test("module._compile() in a Bun.ModuleGraph does not count as a load of the file it names", () => {
    expect(oneLoad.rows["compile-target.cjs"].uncovered).not.toBe("");
    expect(loaded.rows["compile-target.cjs"]).toEqual(oneLoad.rows["compile-target.cjs"]);
  });

  // The line table and the source map on record describe one text, so a load
  // of another text starts the file's coverage over.
  test("a file that changed between two loads reports the last text alone", () => {
    expect(oneLoad.rows["changed.ts"].functions).toBe("50.00");
    expect(loaded.rows["changed.ts"]).toEqual(oneLoad.rows["changed.ts"]);
  });

  test("bun:jsc codeCoverageForFile()", () => {
    expect(JSON.parse(loaded.stdout.split("\n").find(line => line.startsWith("{"))!)).toEqual({
      hostAlone: expect.stringMatching(/host-and-graph\.ts \| +100\.00 \| +\d+\.\d+ \| \d/),
      both: expect.stringMatching(/host-and-graph\.ts \| +100\.00 \| +100\.00 \| $/),
    });
  });
});

// JSC runs a text that bun does not print as it is: a file whose first line starts with
// `// @bun`, and CommonJS under a changed `Module.wrapper`. Such a text can end without a line
// terminator. Under `bun test --coverage` it reports what the same text reports with a newline
// after it.
describe("a text that is not printed by bun", () => {
  // [the text, FNF and FNH, whether lines at the end of the text ran]
  // The report does not count the first byte of a line, so each last line here has more bytes.
  const texts: Record<string, [string, string, Record<number, boolean>]> = {
    "never-ran-alone-on-the-last-line.js": [
      "// @bun\nexport function first() {\n  return 1;\n}\nexport const second = () => 2;",
      "FNF:2\nFNH:1",
      { 5: true },
    ],
    "all-on-the-last-line.js": [
      "// @bun\nexport const first = () => 1; export const second = () => 2;",
      "FNF:2\nFNH:1",
      { 2: true },
    ],
    "branch-not-taken-on-the-last-line.js": [
      "// @bun\nexport const first = () => 1;\nif (globalThis.neverSet)\n  first();",
      "FNF:1\nFNH:1",
      { 4: false },
    ],
    "last-line-of-two-bytes.js": [
      "// @bun\nexport const first = () => {\n  return 1;\n};",
      "FNF:1\nFNH:1",
      { 4: true },
    ],
    "last-byte-closes-a-function-that-never-ran.js": [
      "// @bun\nexport function first() {\n  return 1;\n}\nexport function second() {\n  return 2;\n  }",
      "FNF:2\nFNH:1",
      { 5: false, 6: false },
    ],
    "wrapper-on-the-last-line.cjs": [
      "// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {exports.first = () => 1; exports.second = () => 2;})",
      "FNF:3\nFNH:2",
      { 2: true },
    ],
    // plugin.ts puts the `// @bun` line before this text, so the text that runs has five lines.
    "from-a-plugin.js": [
      "export function first() {\n  return 1;\n}\nexport const second = () => 2;",
      "FNF:2\nFNH:1",
      { 5: true },
    ],
  };
  const terminated = (name: string) => `terminated-${name}`;
  // The row of each of these names a line that did not run, so it shows that the last line is in the report.
  const withRowFromBunJsc = ["branch-not-taken-on-the-last-line.js", "last-byte-closes-a-function-that-never-ran.js"];

  let result: Awaited<ReturnType<typeof run>>;
  beforeAll(async () => {
    const files: Record<string, string> = {
      // coverageIgnoreSourcemaps: the report of wrapped.cjs is then of the text that ran.
      "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\ncoverageIgnoreSourcemaps = true\npreload = ["./plugin.ts"]\n`,
      "plugin.ts": `
import { plugin } from "bun";

plugin({
  name: "pragma",
  setup(build) {
    build.onLoad({ filter: /from-a-plugin\\.js$/ }, async ({ path }) => {
      return { contents: "// @bun\\n" + (await Bun.file(path).text()), loader: "js" };
    });
  },
});
`,
      "empty.cjs": "",
      // bun prints these two. The test puts a wrapper of its own around the printed text.
      "wrapped.cjs": "exports.first = () => 1;\nexports.second = () => 2;\n",
      [terminated("wrapped.cjs")]: "exports.first = () => 1;\nexports.second = () => 2;\n",
      "ends-with-a-carriage-return.js": "// @bun\nexport const first = () => 1;\r",
      "ends-with-a-newline.js": "// @bun\nexport const first = () => 1;\n",
      "never-ran-on-no-line.js": "// @bun\n// \u00a9\u00a9\n\n\n\n\n()=>1;\nexport const first = () => 1;\n",
    };
    // Each text as it is, and with a final newline.
    const names: string[] = [];
    for (const [name, [text]] of Object.entries(texts)) {
      files[name] = text;
      files[terminated(name)] = text + "\n";
      names.push(name, terminated(name));
    }
    files["first.test.ts"] = `
import { expect, test } from "bun:test";
import { codeCoverageForFile } from "bun:jsc";
import Module from "node:module";
import { join } from "node:path";
${names.map((name, i) => (name.endsWith(".cjs") ? `const m${i} = require("./${name}");` : `import * as m${i} from "./${name}";`)).join("\n")}
import * as carriageReturn from "./ends-with-a-carriage-return.js";
import * as newline from "./ends-with-a-newline.js";
import * as onNoLine from "./never-ran-on-no-line.js";
require("./empty.cjs");

test("calls first() and not second()", () => {
  for (const module of [${names.map((_, i) => `m${i}`).join(", ")}, carriageReturn, newline, onNoLine]) {
    expect(module.first()).toBe(1);
  }
  for (const name of ${JSON.stringify(withRowFromBunJsc.flatMap(name => [name, terminated(name)]))}) {
    console.log(JSON.stringify({ name, row: codeCoverageForFile(join(import.meta.dir, name), true) }));
  }
});

test("calls first() and not second() under a changed Module.wrapper", () => {
  const defaultEnd = Module.wrapper[1];
  const end = "\\n;var unused = function () {};})";
  try {
    Module.wrapper[1] = end;
    expect(require("./wrapped.cjs").first()).toBe(1);
    Module.wrapper[1] = end + "\\n";
    expect(require("./${terminated("wrapped.cjs")}").first()).toBe(1);
  } finally {
    Module.wrapper[1] = defaultEnd;
  }
});
`;
    result = await run(files, []);
  });

  // The lcov record of a file without its name, and its table row.
  const record = (file: string) => result.lcov[file].replace(`SF:${file}\n`, "").trim();
  const report = (file: string) => ({ record: record(file), row: result.rows[file] });
  // What codeCoverageForFile() returned in the test, without the name of the file.
  const rowFromBunJsc = (file: string) =>
    result.stdout
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => JSON.parse(line))
      .filter(({ name }) => name === file)
      .map(({ row }) => row.slice(row.indexOf("|")))[0];

  test.each(Object.entries(texts))("%s", (file, [, functions, lines]) => {
    expect({
      functions: record(file).match(/^FNF:\d+\nFNH:\d+$/m)?.[0],
      ran: Object.fromEntries(
        Array.from(record(file).matchAll(/^DA:(\d+),(\d+)$/gm), ([, line, hits]) => [line, hits !== "0"]),
      ),
      row: result.rows[file],
    }).toEqual({
      functions,
      ran: expect.objectContaining(lines),
      row: { functions: expect.any(String), lines: expect.any(String), uncovered: expect.any(String) },
    });
    expect(report(file)).toEqual(report(terminated(file)));
  });

  test.each(withRowFromBunJsc)("bun:jsc codeCoverageForFile() of %s", file => {
    expect(rowFromBunJsc(file)).toMatch(/^\| +\d+\.\d+ \| +\d+\.\d+ \| \d/);
    expect(rowFromBunJsc(file)).toBe(rowFromBunJsc(terminated(file)));
  });

  test("CommonJS under a changed Module.wrapper", () => {
    // first(), second(), the wrapper, and the function in the end of the wrapper.
    expect(result.rows["wrapped.cjs"]).toEqual({ functions: "50.00", lines: "100.00", uncovered: "" });
    expect(report("wrapped.cjs")).toEqual(report(terminated("wrapped.cjs")));
  });

  test("the lcov record of a text with a final newline", () => {
    expect(record(terminated("never-ran-alone-on-the-last-line.js"))).toContain(
      "FNF:2\nFNH:1\nDA:2,10\nDA:3,9\nDA:4,1\nDA:5,21\nLF:4\nLH:4",
    );
  });

  // A carriage return ends a line too, so this text runs as it is.
  test("a text that ends with a carriage return", () => {
    expect(record("ends-with-a-carriage-return.js")).toMatch(/^FNF:1\nFNH:1\nDA:2,\d+\nLF:1\nLH:1$/m);
    expect(report("ends-with-a-carriage-return.js")).toEqual(report("ends-with-a-newline.js"));
  });

  // The text of an empty CommonJS file is a wrapper that bun writes. The file has no line to report.
  test("an empty .cjs file reports no line", () => {
    expect(record("empty.cjs")).toContain("FNF:1\nFNH:1\nLF:0\nLH:0");
  });

  // The line table has four more bytes than JSC has code units before the function on line 7. Each
  // offset of that function is then the start of a blank line, and the report puts it on no line.
  test("a function that never ran and that the line table puts on no line", () => {
    expect(record("never-ran-on-no-line.js")).toContain("FNF:2\nFNH:1\n");
  });

  // Only `bun test --coverage` reads a text by line. A process that turns the profiler on with
  // node:inspector runs the text as it is, as node does.
  test("the text is as it is after Profiler.startPreciseCoverage", async () => {
    const text = texts["never-ran-alone-on-the-last-line.js"][0];
    using dir = tempDir("cov", {
      "subject.js": text,
      "main.mjs": `
import { codeCoverageForFile } from "bun:jsc";
import inspector from "node:inspector/promises";
import { join } from "node:path";

const session = new inspector.Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
(await import("./subject.js")).first();
const row = codeCoverageForFile(join(import.meta.dir, "subject.js"), true);
const { result } = await session.post("Profiler.takePreciseCoverage");
const { functions } = result.find(({ url }) => url.endsWith("subject.js"));
const end = Math.max(...functions.flatMap(({ ranges }) => ranges.map(range => range.endOffset)));
console.log(JSON.stringify({ row: row.slice(row.indexOf("|")), end }));
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      row: expect.stringMatching(/^\| +50\.00 \| +100\.00 \| $/),
      end: text.length,
    });
    expect(exitCode).toBe(0);
  });
});
