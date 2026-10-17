import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, MAX_PATH_BYTES, normalizeBunSnapshot, tempDir } from "harness";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// https://github.com/oven-sh/bun/issues/17502
describe("--coverage-reporter without --coverage turns coverage on", () => {
  const files = {
    "math.ts": `export function add(a: number, b: number) {
  return a + b;
}
export function sub(a: number, b: number) {
  return a - b;
}
`,
    "add.test.ts": `import { expect, test } from "bun:test";
import { add } from "./math";
test("add", () => {
  expect(add(1, 2)).toBe(3);
});
`,
    "sub.test.ts": `import { expect, test } from "bun:test";
import { sub } from "./math";
test("sub", () => {
  expect(sub(3, 2)).toBe(1);
});
`,
  };
  const cases = [
    { flags: ["--coverage-reporter=lcov"], lcov: true, table: false },
    { flags: ["--coverage-reporter", "lcov"], lcov: true, table: false },
    { flags: ["--coverage-reporter=text"], lcov: false, table: true },
    { flags: ["--coverage-reporter=text", "--coverage-reporter=lcov"], lcov: true, table: true },
    { flags: ["--coverage-reporter=lcov", "--parallel=2"], lcov: true, table: false },
  ];

  test.concurrent.each(cases.map(c => [c.flags.join(" "), c] as const))(
    "bun test %s",
    async (_, { flags, lcov, table }) => {
      using dir = tempDir("cov-reporter-alone", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...flags],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const report = Bun.file(path.join(String(dir), "coverage", "lcov.info"));
      expect({
        lcov: (await report.exists()) && (await report.text()).includes("SF:math.ts"),
        table: / math\.ts +\| +100\.00 +\| +100\.00 +\|/.test(stderr),
        exitCode,
      }).toEqual({ lcov, table, exitCode: 0 });
    },
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

  type Row = { functions: string; lines: string; uncovered: string };
  async function run(fixture: Record<string, string>, args: string[], env: Record<string, string> = {}) {
    using dir = tempDir("cov-loaded-twice", fixture);
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
    for (const record of readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8").split(
      "end_of_record",
    )) {
      const file = record.match(/^SF:(.+)$/m)?.[1];
      if (file) lcov[file] = record;
    }
    return { rows, lcov, stdout };
  }

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

// The report names a module by its source URL, relative to the cwd when it is a file.
const longerThanAPathBuffer = MAX_PATH_BYTES + 64;
// The start of a name that is an absolute path on this platform: `/virtual/` or `C:\virtual\`.
const virtualRoot = path.join(path.parse(realpathSync.native(tmpdir())).root, "virtual") + path.sep;

// `virtual` and `urls` are JavaScript expressions: ids of Bun.plugin `build.module()` modules,
// and URLs to import.
function namesFixture({
  virtual = [],
  urls = [],
  bunfig = "",
}: {
  virtual?: string[];
  urls?: string[];
  bunfig?: string;
}) {
  return {
    "bunfig.toml": `[test]\ncoverageSkipTestFiles = false\n${bunfig}`,
    "helper.ts": `
export function helper() {
  return "helper";
}
`,
    "names.test.ts": `
import { test, expect } from "bun:test";
import { helper } from "./helper";

const virtual = [${virtual.join(", ")}];
const urls = [${urls.join(", ")}];

Bun.plugin({
  name: "virtual",
  setup(build) {
    for (const id of virtual) {
      build.module(id, () => ({
        contents: "export function used() { return 1; }\\nexport function unused() { return 0; }\\n",
        loader: "js",
      }));
    }
  },
});

test("imports modules that are not files", async () => {
  for (const id of virtual) expect((await import(id)).used()).toBe(1);
  for (const url of urls) expect((await import(url)).default).toBe(1);
  expect(helper()).toBe("helper");
});
`,
  };
}

const long = (prefix: string, length = longerThanAPathBuffer) =>
  prefix + Buffer.alloc(length - prefix.length, "x").toString();
// The same names as expressions for a fixture.
const longExpr = (prefix: string, length = longerThanAPathBuffer) =>
  `${JSON.stringify(prefix)} + Buffer.alloc(${length - prefix.length}, "x").toString()`;

async function runCoverage(dir: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", ...args],
    cwd: dir,
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  return { stderr, exitCode };
}

// The rows of the text table with each long name replaced by its label and the column padding
// removed, and the `SF:` records of lcov.info. Both sorted: the report orders by the full name,
// which depends on where the temporary directory is.
function tableRows(stderr: string, names: Record<string, string> = {}) {
  return stderr
    .split("\n")
    .filter(line => line.includes(" | "))
    .map(line => withLabels(line, names).replace(/ {2,}/g, " "))
    .sort();
}
function lcovSourceFiles(dir: string, names: Record<string, string> = {}) {
  return readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8")
    .split("\n")
    .filter(line => line.startsWith("SF:"))
    .map(line => withLabels(line, names))
    .sort();
}
function withLabels(line: string, names: Record<string, string>) {
  for (const [label, name] of Object.entries(names)) line = line.replace(name, label);
  return line;
}

describe.concurrent("modules that are not files", () => {
  test("are reported under their source URL as it is", async () => {
    const ids = ["virt//dots/../x/./lib", "myns:some//path/../x", "ns:back\\slash", "trailing/"];
    using dir = tempDir("cov-names", namesFixture({ virtual: ids.map(id => JSON.stringify(id)) }));

    const { stderr, exitCode } = await runCoverage(String(dir), "--coverage-reporter=text", "--coverage-reporter=lcov");

    expect(tableRows(stderr)).toEqual(
      [
        "File | % Funcs | % Lines | Uncovered Line #s",
        "All files | 66.67 | 100.00 |",
        " helper.ts | 100.00 | 100.00 | ",
        " names.test.ts | 100.00 | 100.00 | ",
        ...ids.map(id => ` ${id} | 50.00 | 100.00 | `),
      ].sort(),
    );
    expect(lcovSourceFiles(String(dir))).toEqual(
      ["helper.ts", "names.test.ts", ...ids].map(name => "SF:" + name).sort(),
    );
    expect(exitCode).toBe(0);
  });

  test("are matched against coveragePathIgnorePatterns by that name", async () => {
    using dir = tempDir(
      "cov-names-ignore",
      namesFixture({
        virtual: [`"virtual://app/gen.js"`, `"virtual://lib/kept.js"`],
        bunfig: `coveragePathIgnorePatterns = ["virtual://app/**"]\n`,
      }),
    );

    const { stderr, exitCode } = await runCoverage(String(dir), "--coverage-reporter=lcov");

    expect(stderr).toContain(" 1 pass");
    expect(lcovSourceFiles(String(dir))).toEqual(["SF:helper.ts", "SF:names.test.ts", "SF:virtual://lib/kept.js"]);
    expect(exitCode).toBe(0);
  });

  test("are reported when the name is longer than a path buffer", async () => {
    const names = { "<id>": long("virtual-"), "<abs>": long(virtualRoot) };
    using dir = tempDir("cov-long", namesFixture({ virtual: [longExpr("virtual-"), longExpr(virtualRoot)] }));

    const { stderr, exitCode } = await runCoverage(String(dir), "--coverage-reporter=text", "--coverage-reporter=lcov");

    expect(tableRows(stderr, names)).toEqual(
      [
        "File | % Funcs | % Lines | Uncovered Line #s",
        "All files | 75.00 | 100.00 |",
        " helper.ts | 100.00 | 100.00 | ",
        " names.test.ts | 100.00 | 100.00 | ",
        " <id> | 50.00 | 100.00 | ",
        " <abs> | 50.00 | 100.00 | ",
      ].sort(),
    );
    // Such a name does not set the width of the File column.
    expect(stderr.split("\n").find(line => line.startsWith("File"))).toBe(
      "File".padEnd("names.test.ts".length + 1) + " | % Funcs | % Lines | Uncovered Line #s",
    );
    expect(lcovSourceFiles(String(dir), names)).toEqual(
      ["SF:helper.ts", "SF:names.test.ts", "SF:<id>", "SF:<abs>"].sort(),
    );
    expect(exitCode).toBe(0);
  });

  // Every row is fully covered, so the test does not say whether a `data:` module has a row.
  test("a data: URL longer than a path buffer does not stop the report", async () => {
    using dir = tempDir("cov-long-data", {
      "bunfig.toml": `[test]\ncoverageSkipTestFiles = false\n`,
      "helper.ts": `
export function helper() {
  return "helper";
}
`,
      "data.test.ts": `
import { test, expect } from "bun:test";
import { helper } from "./helper";

test("imports a data: URL", async () => {
  const url = "data:text/javascript," + encodeURIComponent("export default 1; //") + ${longExpr("")};
  expect((await import(url)).default).toBe(1);
  expect(helper()).toBe("helper");
});
`,
    });

    const { stderr, exitCode } = await runCoverage(String(dir), "--coverage-reporter=text", "--coverage-reporter=lcov");

    const notTheUrl = (line: string) => !line.includes("data:text/javascript");
    expect(tableRows(stderr).filter(notTheUrl)).toEqual(
      [
        "File | % Funcs | % Lines | Uncovered Line #s",
        "All files | 100.00 | 100.00 |",
        " data.test.ts | 100.00 | 100.00 | ",
        " helper.ts | 100.00 | 100.00 | ",
      ].sort(),
    );
    expect(lcovSourceFiles(String(dir)).filter(notTheUrl)).toEqual(["SF:data.test.ts", "SF:helper.ts"]);
    expect(exitCode).toBe(0);
  });

  test("longer than a path buffer are matched against coveragePathIgnorePatterns", async () => {
    const names = { "<kept>": long("kept-") };
    using dir = tempDir(
      "cov-long-ignore",
      namesFixture({
        virtual: [longExpr("virtual-"), longExpr("kept-")],
        bunfig: `coveragePathIgnorePatterns = ["virtual-*"]\n`,
      }),
    );

    const { stderr, exitCode } = await runCoverage(String(dir), "--coverage-reporter=lcov");

    expect(stderr).toContain(" 1 pass");
    expect(lcovSourceFiles(String(dir), names)).toEqual(["SF:helper.ts", "SF:names.test.ts", "SF:<kept>"].sort());
    expect(exitCode).toBe(0);
  });

  // The `kept-` module is the only row under the threshold, so the run fails only when a
  // worker's report of a long name reaches the coordinator.
  test("longer than a path buffer count toward coverageThreshold under --parallel", async () => {
    const names = { "<kept>": long("kept-") };
    using dir = tempDir("cov-long-parallel", {
      ...namesFixture({
        virtual: [longExpr("virtual-"), longExpr("kept-")],
        bunfig: `coveragePathIgnorePatterns = ["virtual-*"]\ncoverageThreshold = { functions = 1.0 }\n`,
      }),
      "other.test.ts": `
import { test, expect } from "bun:test";
test("other", () => {
  expect(1).toBe(1);
});
`,
    });

    const { stderr, exitCode } = await runCoverage(
      String(dir),
      "--coverage-reporter=text",
      "--coverage-reporter=lcov",
      "--parallel=2",
    );

    expect(tableRows(stderr, names)).toEqual(
      [
        "File | % Funcs | % Lines | Uncovered Line #s",
        "All files | 87.50 | 100.00 |",
        " helper.ts | 100.00 | 100.00 | ",
        " names.test.ts | 100.00 | 100.00 | ",
        " other.test.ts | 100.00 | 100.00 | ",
        " <kept> | 50.00 | 100.00 | ",
      ].sort(),
    );
    expect(lcovSourceFiles(String(dir), names)).toEqual(
      ["SF:helper.ts", "SF:names.test.ts", "SF:other.test.ts", "SF:<kept>"].sort(),
    );
    expect(exitCode).toBe(1);
  });

  // `relative()` normalizes a POSIX path of up to MAX_PATH_BYTES bytes. A Windows path can
  // grow by a byte when it is normalized and starts one byte into the buffer.
  test("that look like a path are made relative up to the longest that relative() takes", async () => {
    const longest = isWindows ? MAX_PATH_BYTES - 2 : MAX_PATH_BYTES;
    const lengths = [longest - 1, longest, longest + 1, longest + 2];
    const ids = lengths.map(length => long(virtualRoot, length));
    using dir = tempDir("cov-limits", namesFixture({ virtual: lengths.map(length => longExpr(virtualRoot, length)) }));

    const { stderr, exitCode } = await runCoverage(String(dir), "--coverage-reporter=lcov");

    expect(stderr).toContain(" 1 pass");
    const relative = (id: string) => path.relative(String(dir), id);
    expect(lcovSourceFiles(String(dir))).toEqual(
      ["helper.ts", "names.test.ts", relative(ids[0]), relative(ids[1]), ids[2], ids[3]]
        .map(name => "SF:" + name)
        .sort(),
    );
    expect(exitCode).toBe(0);
  });

  // The relative name of this file is longer than a path buffer although both paths fit one.
  // A Windows path of ASCII names is too short for that: 32,767 characters against 98,302 bytes.
  test.skipIf(isWindows)("a file far outside a deep cwd keeps its relative name", async () => {
    using dir = tempDir("cov-deep", {});
    const root = String(dir);
    // As many 200-byte names as a path can hold, and enough levels of cwd for the rest.
    const farNames = Math.floor((MAX_PATH_BYTES - 64 - root.length) / 201);
    const cwd = path.join(root, ...Array(Math.ceil((MAX_PATH_BYTES + 64 - farNames * 201) / 3)).fill("c"));
    const farDir = path.join(root, ...Array(farNames).fill(long("f", 200)));
    const farFile = path.join(farDir, "helper.ts");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(farDir, { recursive: true });
    writeFileSync(farFile, `export function helper() {\n  return "helper";\n}\n`);
    writeFileSync(path.join(cwd, "bunfig.toml"), `[test]\ncoverageSkipTestFiles = false\n`);
    writeFileSync(
      path.join(cwd, "far.test.ts"),
      `import { test, expect } from "bun:test";
import { helper } from ${JSON.stringify(farFile)};
test("far", () => {
  expect(helper()).toBe("helper");
});
`,
    );
    expect(path.relative(cwd, farFile).length).toBeGreaterThan(MAX_PATH_BYTES);

    const { stderr, exitCode } = await runCoverage(cwd, "--coverage-reporter=lcov");

    expect(stderr).toContain(" 1 pass");
    expect(lcovSourceFiles(cwd)).toEqual(["SF:" + path.relative(cwd, farFile), "SF:far.test.ts"]);
    expect(exitCode).toBe(0);
  });
});
