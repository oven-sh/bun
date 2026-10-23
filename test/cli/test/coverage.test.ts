import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, MAX_PATH_BYTES, normalizeBunSnapshot, tempDir } from "harness";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "path";

/** The record of `file` in the `lcov.info` of `dir`. */
function recordOf(dir: string, file: string) {
  const lcov = readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => /^SF:(.*)$/m.exec(r)?.[1].endsWith(file));
  expect(record).toBeDefined();
  return record!;
}

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
---------------|---------|---------|----------|-------------------
File           | % Funcs | % Lines | % Branch | Uncovered Line #s
---------------|---------|---------|----------|-------------------
All files      |  100.00 |  100.00 |   100.00 |
 include-me.ts |  100.00 |  100.00 |   100.00 | 
 test.test.ts  |  100.00 |  100.00 |   100.00 | 
---------------|---------|---------|----------|-------------------

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
---------------|---------|---------|----------|-------------------
File           | % Funcs | % Lines | % Branch | Uncovered Line #s
---------------|---------|---------|----------|-------------------
All files      |   75.00 |   75.00 |   100.00 |
 include-me.ts |   50.00 |   50.00 |   100.00 | 6-7
 test.test.ts  |  100.00 |  100.00 |   100.00 | 
---------------|---------|---------|----------|-------------------

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
--------------|---------|---------|----------|-------------------
File          | % Funcs | % Lines | % Branch | Uncovered Line #s
--------------|---------|---------|----------|-------------------
All files     |  100.00 |  100.00 |   100.00 |
 src/main.ts  |  100.00 |  100.00 |   100.00 | 
 test.test.ts |  100.00 |  100.00 |   100.00 | 
--------------|---------|---------|----------|-------------------

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
----------------|---------|---------|----------|-------------------
File            | % Funcs | % Lines | % Branch | Uncovered Line #s
----------------|---------|---------|----------|-------------------
All files       |  100.00 |  100.00 |   100.00 |
 main.test.ts   |  100.00 |  100.00 |   100.00 | 
 src/feature.ts |  100.00 |  100.00 |   100.00 | 
----------------|---------|---------|----------|-------------------

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
BRF:0
BRH:0
DA:2,1
DA:3,1
LF:2
LH:2
end_of_record
TN:
SF:test.test.ts
FNF:1
FNH:1
BRF:0
BRH:0
DA:2,1
DA:3,1
DA:4,1
DA:6,1
DA:7,1
DA:8,1
DA:9,1
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
---------------|---------|---------|----------|-------------------
File           | % Funcs | % Lines | % Branch | Uncovered Line #s
---------------|---------|---------|----------|-------------------
All files      |  100.00 |  100.00 |   100.00 |
 include-me.ts |  100.00 |  100.00 |   100.00 | 
 test.test.ts  |  100.00 |  100.00 |   100.00 | 
---------------|---------|---------|----------|-------------------

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
-----------|---------|---------|----------|-------------------
File       | % Funcs | % Lines | % Branch | Uncovered Line #s
-----------|---------|---------|----------|-------------------
All files  |    0.00 |    0.00 |     0.00 |
-----------|---------|---------|----------|-------------------

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

  const record = recordOf(String(dir), "subject.ts");
  // Blank line 5 is only "executable" in the worker that never ran count().
  expect(record).not.toContain("DA:5,");
  expect(record).toMatch(/LF:4\nLH:4\n/);

  expect(stderr).toMatch(/ subject\.ts +\| +100\.00 +\| +100\.00 +\| +100\.00 +\| +\n/);
  expect(exitCode).toBe(0);
});

// Each test file waits at import time until the other has started, so the
// two can only make progress in two different workers.
const rendezvous = (me: string, other: string) => `
await Bun.write("${me}.started", "");
for (const deadline = Date.now() + 60_000; !(await Bun.file("${other}.started").exists()); ) {
  if (Date.now() > deadline) throw new Error("${other} never started in another worker");
  await Bun.sleep(5);
}
`;

// https://github.com/oven-sh/bun/issues/40586
// Each worker executes a different function of the same module; the merged
// report must count a function as covered if any worker ran it.
test("--parallel merges function coverage across workers", async () => {
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
  expect(stderr).toMatch(/ subject\.ts +\| +100\.00 +\| +100\.00 +\| +100\.00 +\| +\n/);
  const record = recordOf(String(dir), "subject.ts");
  expect(record).toMatch(/FNF:2\nFNH:2\n/);
  expect(exitCode).toBe(0);
});

// JSC records coverage per SourceProvider, and a file has one for each time
// it is loaded. Each case has a subject file of its own. Where a case loads
// its subject twice, one load runs the `if` branch and the other runs the
// `return` after it.
test("what is after a rejected await at the top level of a module did not run", async () => {
  using dir = tempDir("cov-top-level-await", {
    "subject.ts": `let ran = 0;
export const first = await 1;
ran++;
try {
  await Promise.reject(new Error());
  ran++;
} catch {
  ran++;
}
export default await ran;
export { ran };
`,
    "subject.test.ts": `
import { expect, test } from "bun:test";
import ran from "./subject.ts";

test("ran", () => {
  expect(ran).toBe(2);
});
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const record = recordOf(String(dir), "subject.ts");
  expect(record.match(/^DA:.*$/gm)).toEqual([
    "DA:1,1",
    "DA:2,1",
    "DA:3,1",
    "DA:4,1",
    "DA:5,1",
    "DA:6,0",
    "DA:7,1",
    "DA:8,1",
    "DA:10,1",
    "DA:11,1",
  ]);
  expect(stderr).toContain(" 1 pass");
  expect(exitCode).toBe(0);
});

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

  type Row = { functions: string; lines: string; branches: string; uncovered: string };
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
      const [file, functions, lines, branches, uncovered] = line.split("|").map(column => column.trim());
      if (uncovered !== undefined) rows[file] = { functions, lines, branches, uncovered };
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

  const fullyCovered: Row = { functions: "100.00", lines: "100.00", branches: "100.00", uncovered: "" };

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
      branches: "100.00",
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
      hostAlone: expect.stringMatching(/host-and-graph\.ts \| +100\.00 \| +\d+\.\d+ \| +50\.00 \| \d/),
      both: expect.stringMatching(/host-and-graph\.ts \| +100\.00 \| +100\.00 \| +100\.00 \| $/),
    });
  });
});

test("prints the report when a data: URL is longer than the path buffer", async () => {
  using dir = tempDir("cov-long-data", {
    "bunfig.toml": `[test]\ncoverageSkipTestFiles = false\n`,
    "data.test.ts": `
import { test, expect } from "bun:test";

test("imports a data: URL", async () => {
  const url = "data:text/javascript," + encodeURIComponent("export default 1; //") + Buffer.alloc(${MAX_PATH_BYTES}, "x").toString();
  expect((await import(url)).default).toBe(1);
});
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 1 pass");
  expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8")).toContain("SF:data.test.ts\n");
  expect(exitCode).toBe(0);
});

test("reports an uncalled function on the last line of a // @bun file without a final newline", async () => {
  using dir = tempDir("cov-no-final-newline", {
    "prebuilt.js": "// @bun\nexport function first() {\n  return 1;\n}\nexport const second = () => 2;",
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { first } from "./prebuilt.js";
      test("calls first", () => { expect(first()).toBe(1); });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toMatch(/prebuilt\.js +\| +50\.00 \|/);
  expect(exitCode).toBe(0);
});

type Mode = "transpiled" | "// @bun" | "// @bun with a source map" | "coverageIgnoreSourcemaps";

/** The lcov record of `lib` after `testFile`, which imports it from "./lib.js", and how many lines are above `lib` in it. */
async function coverageOfLib(mode: Mode, lib: string, testFile: string) {
  using dir = tempDir("cov-lib", {
    "lib.test.ts": testFile,
    ...(mode === "// @bun"
      ? { "lib.js": "// @bun\n" + lib }
      : mode === "// @bun with a source map"
        ? { "src/lib.js": lib }
        : mode === "coverageIgnoreSourcemaps"
          ? { "lib.js": lib, "bunfig.toml": "[test]\ncoverageIgnoreSourcemaps = true\n" }
          : { "lib.js": lib }),
  });
  if (mode === "// @bun with a source map") {
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "./src/lib.js", "--target=bun", "--sourcemap=linked", "--outdir=."],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "inherit",
    });
    expect(await build.exited).toBe(0);
    expect(readFileSync(path.join(String(dir), "lib.js"), "utf-8")).toStartWith("// @bun\n");
  }
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  return { record: recordOf(String(dir), "lib.js"), above: mode === "// @bun" ? 1 : 0, exitCode };
}

// `braces.ts` in `source-positions-corpus.ts` has this for a file that Bun transpiles and reports by its source map.
test.concurrent.each(["// @bun", "// @bun with a source map", "coverageIgnoreSourcemaps"] as const)(
  "both braces of an object are listed and no brace of a block is: %s",
  async mode => {
    // Laid out as the printer prints it, so that the lines are the same with coverageIgnoreSourcemaps.
    const lib = `export function f() {
  {
    globalThis.list = [
      {
        one: 1
      }
    ];
  }
  for (const item of globalThis.list) {
    return item;
  }
}
`;
    const { record, above, exitCode } = await coverageOfLib(
      mode,
      mode === "// @bun" ? lib + "await 0;\nif (false) globalThis.list = [\n  {\n  }\n];\n" : lib,
      `
        import { expect, test } from "bun:test";
        import { f } from "./lib.js";
        test("f", () => { expect(f()).toEqual({ one: 1 }); });
      `,
    );
    const count = (line: number) => record.match(new RegExp(`^DA:${line + above},(\\d+)$`, "m"))?.[1];
    expect([2, 4, 6, 8, 11, 12].map(count)).toEqual([undefined, "1", "1", undefined, undefined, undefined]);
    if (mode === "// @bun") {
      expect(record).toContain("DA:16,0");
      expect(record).toContain("DA:17,0");
    }
    expect(exitCode).toBe(0);
  },
);

describe("branches", () => {
  // After `//` are the branches of each decision that starts on the line, in the order of the
  // decisions, and how often each was taken. The last of `[1,2]` is the branch without code of its own,
  // except for `if` with `else`, `?:`, and a `switch` with `default`.
  // `for`-`in` and `for`-`of` have one branch, the body.
  // Laid out as the printer prints it, so that the lines are the same with coverageIgnoreSourcemaps.
  const lib = `const Kind = { A: 1 };
export function decisions(v, o, list) {
  let r = v ? 1 : 2; // [2,1]
  if (v) { // [2,1]
    r = 1;
  }
  if (v) // [2,1]
    r = 1;
  else if (o) // [0,1]
    r = 2;
  else
    r = 3;
  if (v) // [2,1]
    ;
  if (v) // [2,1]
    ;
  else
    ;
  if (v) // [2,1]
    ;
  else
    r = 3;
  if (v) // [2,1]
    r = 1;
  else
    ;
  if (v) // [2,1]
    label:
      r = 1;
  r = v && o; // [2,1]
  r = v || o; // [1,2]
  r = o ?? v; // [1,2]
  r = v && o || list; // [2,1] [1,2]
  r = o?.a; // [2,1]
  r = o?.a?.b; // [2,1] [1,1]
  r = o?.a?.b.c(v && 1); // [2,1] [1,1] [1,0]
  r = o?.["a"]; // [2,1]
  r = o?.f?.(); // [2,1] [0,2]
  r = v ? () => 1 : () => 2; // [2,1]
  r = v || (() => 1); // [1,2]
  r ||= v; // [0,3]
  r &&= o; // [3,0]
  r ??= v; // [1,2]
  const { a = 1, b: { c = 2 } = {} } = o ?? {}; // [1,2] [3,0] [3,0] [1,2]
  const [d = 3] = list; // [1,2]
  [r = 4] = list; // [1,2]
  [r = 7][0] = v;
  [(r = {}).x] = list;
  [...[r = 8]] = list; // [1,2]
  ({ z: { b: r = 9 } = {} } = o ?? {}); // [3,0] [3,0] [1,2]
  ({ r = 5, a: r = 6 } = o ?? {}); // [3,0] [1,2] [1,2]
  return r;
}
export function defaults(a = 1, { b = 2 } = {}, [c = 3] = []) { // [1,1] [2,0] [2,0] [2,0] [2,0]
  return (d = a) => d; // [0,0]
}
export function loops(n, list) {
  let i = 0;
  while (i < n && list) // [3,1] [3,1]
    i++;
  for (i = 0; i < n || !list; i += list.step ?? 1) // [3,1] [1,3] [3,0]
    list;
  do
    i--;
  while (i > 0 && list); // [2,1] [2,1]
  for (const [a = 1] of list) // [3] [1,2]
    list;
  for (const { b = 2 } of list) // [3] [3,0]
    list;
  for ([i = 3] of list) // [3] [1,2]
    list;
  for ({ i = 4 } of list) // [3] [3,0]
    list;
  for ((list.t ?? list).k in { a: 1, b: 2 }) // [2] [2,0]
    list;
  while (i < 0) // [0,1]
    label:
      i++;
  for (const k in {}) // [0]
    list;
  for (const item of []) // [0]
    list;
  do {
    if (i++ > 5) // [1,2]
      break;
  } while (true); // [2,0]
  for (;; ) {
    break;
  }
}
export function catches(f) {
  try { // [1,2]
    f();
  } catch {
    return 1;
  }
  try { // [0,2]
    f();
  } catch (error) {
    return error;
  } finally {
    f;
  }
  try {
    f();
  } finally {
    f;
  }
}
export function switches(v, o) {
  switch (v) { // [1,1,2]
    case 1:
      break;
    case 2:
      break;
  }
  switch (v) { // [1,3]
    case 1:
      break;
    default:
  }
  switch (v) { // [1,1,0,2]
    case 1:
    case 2: {
      break;
    }
    case 3:
  }
  switch (v) { // [1,1,2]
    case 1:
      Kind.last = v;
    case 2:
  }
  switch (v) { // [1,1,2]
    case 1: {
      using none = null;
      break;
    }
    case 2:
  }
  switch (v) { // [1,0,0,0,0,0,3]
    case Kind.A:
      return;
    case o && o.a: // [2,1]
      break;
    case o?.a: // [2,1]
      break;
    case [o].find(x => x && x.b): // [2,1]
      break;
    case (function () {
      return o || 1; // [1,2]
    })():
      break;
    case (o ??= {}): // [1,2]
  }
}

export class Fields {
  a = Fields.none ?? 1; // [2,0]
  static b = Fields.none || 2; // [1,0]
  #c = Fields.none?.c; // [0,2]
}
export function never(v) {
  return v ? 1 : v && 2; // [0,0] [0,0]
}
`;
  /** `[line, [hits of each branch]]` of each decision. */
  const expectedOf = (lib: string) =>
    lib
      .split("\n")
      .flatMap((text, i) =>
        [...(text.split(" // ")[1] ?? "").matchAll(/\[([\d,]+)\]/g)].map((m): [number, number[]] => [
          i + 1,
          m[1].split(",").map(Number),
        ]),
      );
  function decisionsOf(record: string) {
    const decisions = new Map<string, [number, number[]]>();
    for (const [, line, decision, branch, hits] of record.matchAll(/^BRDA:(\d+),(\d+),(\d+),(\d+)$/gm)) {
      if (!decisions.has(decision)) decisions.set(decision, [Number(line), []]);
      decisions.get(decision)![1][Number(branch)] = Number(hits);
    }
    // The decision of a `do`-`while` is after those in its body, and has the lower number.
    return [...decisions.values()].sort(([a], [b]) => a - b);
  }

  test.concurrent.each(["transpiled", "// @bun", "coverageIgnoreSourcemaps"] as const)(
    "every branch has its hit count: %s",
    async mode => {
      const { record, above, exitCode } = await coverageOfLib(
        mode,
        lib,
        `
        import { test } from "bun:test";
        import { catches, decisions, defaults, loops, switches, Fields } from "./lib.js";
        test("lib", () => {
          decisions(1, { a: { b: { c() {} } } }, [1]);
          decisions(2, { a: null }, []);
          decisions(0, null, [0]);
          defaults();
          defaults(0);
          loops(3, [[], [1], [2]]);
          catches(() => {});
          catches(() => {});
          catches(() => { throw 1; });
          switches(1, { a: 7 });
          switches(2, { a: 7 });
          switches(9, { a: 7 });
          switches(9, null);
          new Fields();
          new Fields();
        });
      `,
      );
      const expected = expectedOf(lib);
      expect(decisionsOf(record)).toEqual(expected.map(([line, hits]) => [line + above, hits]));
      const all = expected.flatMap(([, hits]) => hits);
      expect(record).toContain(`BRF:${all.length}\nBRH:${all.filter(hits => hits > 0).length}\n`);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent.each(["transpiled", "// @bun"] as const)("a line with a BRDA has a DA: %s", async mode => {
    const { record, above, exitCode } = await coverageOfLib(
      mode,
      `export function pattern(
  {
    a = 1,
  } = {},
) {
  return a;
}
`,
      `
        import { test } from "bun:test";
        import { pattern } from "./lib.js";
        test("lib", () => {
          pattern();
          pattern({ a: 2 });
        });
      `,
    );
    expect(decisionsOf(record)).toEqual([
      [3 + above, [1, 1]],
      [4 + above, [1, 1]],
    ]);
    expect(record).toContain(`\nDA:${3 + above},`);
    expect(record).toContain(`\nDA:${4 + above},`);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(["transpiled", "// @bun"] as const)(
    "an inlined const has the position of the name it replaces: %s",
    async mode => {
      const inlinedLib = `const M = 2;
export function inlined(v, o, t = M) { // [3,0]
  const L = 3;
  let r = v ?? L; // [1,2]
  r = v || L; // [2,1]
  r = v && L; // [1,2]
  r = v ? L : 1; // [1,2]
  r = L ? v : 1; // [3,0]
  r = L && v; // [3,0]
  r = L?.x; // [3,0]
  r = o?.[L]; // [2,1]
  r ??= L; // [3,0]
  const { x = L } = o ?? {}; // [3,0] [1,2]
  [r = L] = []; // [3,0]
  return (p = L) => p; // [0,0]
}
`;
      const { record, above, exitCode } = await coverageOfLib(
        mode,
        inlinedLib,
        `
          import { test } from "bun:test";
          import { inlined } from "./lib.js";
          test("lib", () => {
            inlined(1, {});
            inlined(0, null);
            inlined(null, {});
          });
        `,
      );
      expect(decisionsOf(record)).toEqual(expectedOf(inlinedLib).map(([line, hits]) => [line + above, hits]));
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("a // @bun file with a source map has its lines and no branches", async () => {
    const { record, exitCode } = await coverageOfLib(
      "// @bun with a source map",
      `export function pick(v) {
  return v ? 1 : 2;
}
`,
      `
        import { test } from "bun:test";
        import { pick } from "./lib.js";
        test("lib", () => { pick(1); });
      `,
    );
    expect(record).toContain("DA:2,1\n");
    expect(decisionsOf(record)).toEqual([]);
    expect(record).toContain("BRF:0\nBRH:0\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("code that the transpiler generates adds no branches", async () => {
    using dir = tempDir("cov-branches-ts", {
      "lib.tsx": `enum Color { Red, Green = "g" }
export namespace Outer { export const a = Color.Red; export namespace Inner { export const b = 2; } }
function decorate(value: any, context: any) { return value; }
class Base { x = 1; static s = 2; constructor(public q: number, readonly r?: number) {} }
@decorate class Derived extends Base { @decorate m() { return this.x; } accessor a = 1; y?: number = 4; }
export async function dispose() { using a = { [Symbol.dispose]() {} }; await using b = { async [Symbol.asyncDispose]() {} }; }
export function element(props: any) { return <div a={props.a} {...props}>{props.c}<></></div>; }
export function* generator() { yield 1; yield* [2]; }
export const derived = new Derived(1);
`,
      "node_modules/react/package.json": `{ "name": "react", "version": "0.0.0" }`,
      "node_modules/react/jsx-dev-runtime.js": `export const jsxDEV = () => ({}); export const Fragment = 1;`,
      "lib.test.ts": `
        import { test } from "bun:test";
        import * as lib from "./lib.tsx";
        test("lib", async () => { await lib.dispose(); lib.element({}); });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    const record = recordOf(String(dir), "lib.tsx");
    expect(decisionsOf(record)).toEqual([]);
    expect(record).toContain("BRF:0\nBRH:0\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
    ["coverageThreshold = 0.9", 0],
    ["coverageThreshold = { lines = 0.9 }", 0],
    ["coverageThreshold = { branches = 0.5 }", 0],
    ["coverageThreshold = { branches = 0.6 }", 1],
  ])("with %s, half of the branches taken exits with %d", async (threshold, expectedExitCode) => {
    using dir = tempDir("cov-branches-threshold", {
      "lib.ts": `export const pick = (v: number) => (v ? 1 : 2);\n`,
      "plain.ts": `export const one = 1;\n`,
      "lib.test.ts": `
        import { test } from "bun:test";
        import { pick } from "./lib.ts";
        import { one } from "./plain.ts";
        test("pick", () => { pick(one); });
      `,
      "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\n${threshold}\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("File       | % Funcs | % Lines | % Branch | Uncovered Line #s\n");
    // Of all branches, and not the mean of 50 and 100.
    expect(stderr).toContain("All files  |  100.00 |  100.00 |    50.00 |\n");
    // Every line ran, so the last column has the lines with a branch that was not taken.
    expect(stderr).toContain(" lib.ts    |  100.00 |  100.00 |    50.00 | 1\n");
    expect(stderr).toContain(" plain.ts  |  100.00 |  100.00 |   100.00 | \n");
    expect(exitCode).toBe(expectedExitCode);
  });

  test.concurrent("--parallel adds up branch hits across workers", async () => {
    using dir = tempDir("cov-branches-parallel", {
      "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\ncoverageThreshold = { branches = 1.0 }\n`,
      "lib.ts": `export const pick = (v: number) => (v ? 1 : 2);\nexport const both = (v: number) => v && 1;\n`,
      "first.test.ts": `${rendezvous("first", "second")}
import { test } from "bun:test";
import { both, pick } from "./lib.ts";
test("first", () => { pick(1); both(1); both(0); });
`,
      "second.test.ts": `${rendezvous("second", "first")}
import { test } from "bun:test";
import { both, pick } from "./lib.ts";
test("second", () => { pick(0); pick(0); both(1); });
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--parallel=2"],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toMatch(/ lib\.ts +\| +100\.00 +\| +100\.00 +\| +100\.00 +\| +\n/);
    expect(decisionsOf(recordOf(String(dir), "lib.ts"))).toEqual([
      [1, [1, 2]],
      [2, [2, 1]],
    ]);
    expect(exitCode).toBe(0);
  });
});

test("the braces of an object and the branches are listed when the file comes from the transpiler cache", async () => {
  using dir = tempDir("cov-transpiler-cache", {
    // The cache leaves out a file of less than 4 KB.
    "lib.ts": `export const list = [
  {
    one: 1,
  },
];
export const first = list[0] ?? null;
// ${Buffer.alloc(4096, "-")}
`,
    "lib.test.ts": `
import { test } from "bun:test";
import { list } from "./lib.ts";
test("list", () => { Object(list); });
`,
  });
  const cache = path.join(String(dir), "cache");
  const run = async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov"],
      env: {
        ...bunEnv,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache,
        // A debug build only writes the cache without it.
        BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
      },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    return { record: recordOf(String(dir), "lib.ts"), exitCode };
  };
  // A run that does not take the entry writes it again.
  const written = () =>
    readdirSync(cache).map(name => [name, statSync(path.join(cache, name), { bigint: true }).mtimeNs]);
  const printed = await run();
  const entries = written();
  expect(entries).not.toBeEmpty();
  expect(printed.record).toContain("DA:2,1\n");
  expect(printed.record).toContain("DA:4,1\n");
  expect(printed.record).toContain("BRDA:6,1,0,0\nBRDA:6,1,1,1\n");
  expect(await run()).toEqual(printed);
  expect(written()).toEqual(entries);
  expect(printed.exitCode).toBe(0);
});

test("objects that are not in the file do not move the lines that are listed", async () => {
  using dir = tempDir("cov-generated-objects", {
    "macro.ts": `export const make = () => ({ a: { b: 1 }, c: [{}] });`,
    "lib.ts": `// 1
// 2
// 3
// 4
import { make } from "./macro.ts" with { type: "macro" };
declare const DEFINED: object;
export const made = make();
export const defined =
  DEFINED;
export const list = [
  {
    one: 1,
  },
];
`,
    "lib.test.ts": `
import { test } from "bun:test";
import * as lib from "./lib.ts";
test("lib", () => { Object(lib); });
`,
  });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      "--coverage",
      "--coverage-reporter=lcov",
      "--define",
      'DEFINED={"a":1, "b":  { "c": [{  }] }}',
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  const record = recordOf(String(dir), "lib.ts");
  expect(record.match(/^DA:.*$/gm)).toEqual([7, 8, 9, 10, 11, 12, 13, 14].map(line => `DA:${line},1`));
  expect(exitCode).toBe(0);
});

test("node:inspector turns the profiler on and no brace is listed", async () => {
  const lib = `export const never = () => (
  {
    one: 1,
  }
);
`;
  using dir = tempDir("cov-inspector", {
    "lib.ts": lib,
    "bundled.js": "// @bun\n" + lib,
    "main.ts": `
import { codeCoverageForFile } from "bun:jsc";
import inspector from "node:inspector";
import { join } from "node:path";
const session = new inspector.Session();
session.connect();
session.post("Profiler.enable");
session.post("Profiler.startPreciseCoverage");
for (const file of ["lib.ts", "bundled.js"]) {
  await import("./" + file);
  console.log(codeCoverageForFile(join(import.meta.dir, file), false).split("|").at(-1));
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe(" 3\n 4\n");
  expect(exitCode).toBe(0);
});

test("an error has the same position with --coverage", async () => {
  using dir = tempDir("cov-error-position", {
    "lib.ts": `export function disposes() {
  {
    using thrower = { [Symbol.dispose]() { throw new Error("disposed"); } };
    Object(thrower);
  }
}
`,
    "lib.test.ts": `
import { test } from "bun:test";
import { disposes } from "./lib.ts";
test("disposes", () => {
  try {
    disposes();
  } catch (error) {
    console.log(error.stack.split("\\n").find(line => line.includes("at disposes")));
  }
});
`,
  });
  const [plain, covered] = await Promise.all(
    [[], ["--coverage"]].map(async flags => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...flags],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "ignore",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { frame: stdout.split("\n").find(line => line.includes("at disposes")), exitCode };
    }),
  );
  expect(plain.frame).toEndWith("lib.ts:5:3)");
  expect(covered).toEqual(plain);
  expect(plain.exitCode).toBe(0);
});

test("reports an error for a coverage directory longer than the path buffer", async () => {
  // A bunfig value can be longer than the buffer on every platform.
  using dir = tempDir("coverage-dir-too-long", {
    "bunfig.toml": `[test]\ncoverageDir = "${Buffer.alloc(100_000, "c").toString()}"\n`,
    "lib.ts": `export const covered = () => 1;`,
    "covered.test.ts": `
      import { test, expect } from "bun:test";
      import { covered } from "./lib";
      test("covered", () => { expect(covered()).toBe(1); });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("(pass) covered");
  expect(stderr).toContain("ENAMETOOLONG: File name too long: Failed to write lcov.info");
  expect(exitCode).toBe(1);
});
