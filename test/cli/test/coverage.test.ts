import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";
import { readFileSync } from "node:fs";
import path from "path";

/// Runs `bun test --coverage <args>` in `dir` and returns the normalized
/// output plus the lcov report, if one was written.
async function runCoverage(dir: string, args: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", ...args],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let lcov: string | null = null;
  const lcovFile = Bun.file(path.join(dir, "coverage", "lcov.info"));
  if (await lcovFile.exists()) {
    lcov = normalizeBunSnapshot(await lcovFile.text(), dir);
  }
  return { stdout, stderr: normalizeBunSnapshot(stderr, dir), exitCode, lcov };
}

test("coverage crash", () => {
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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
All files      |   75.00 |   75.00 |
 include-me.ts |   50.00 |   50.00 | 6-7
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
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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
DA:2,1
DA:3,1
LF:2
LH:2
end_of_record
TN:
SF:test.test.ts
FNF:1
FNH:1
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
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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
  const dir = tempDirWithFiles("cov", {
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

// math.ts covers 1 of 2 functions: `add` runs, `neverCalled` never does.
const thresholdFixture = {
  "math.ts": `export function add(a: number, b: number) {
  return a + b;
}
export function neverCalled() {
  return 42;
}
`,
  "math.test.ts": `import { test, expect } from "bun:test";
import { add } from "./math";
test("add", () => {
  expect(add(1, 2)).toBe(3);
});
`,
};

test.concurrent("coverageThreshold is enforced for every reporter, not only text", async () => {
  const dir = tempDirWithFiles("cov-threshold-reporters", {
    "bunfig.toml": `
[test]
coverageThreshold = { lines = 0.9, functions = 0.9 }
coverageSkipTestFiles = true
`,
    ...thresholdFixture,
  });

  for (const reporter of ["lcov", "text"] as const) {
    const { stderr, exitCode } = await runCoverage(dir, [`--coverage-reporter=${reporter}`]);
    expect({
      reporter,
      error: stderr.includes(
        "error: Coverage is below the configured test.coverageThreshold (functions: 90.00%, lines: 90.00%)",
      ),
      exitCode,
    }).toEqual({ reporter, error: true, exitCode: 1 });
  }
});

test.concurrent("coverageThreshold is enforced with coverageReporter = []", async () => {
  // https://github.com/oven-sh/bun/issues/32118
  const dir = tempDirWithFiles("cov-threshold-no-reporters", {
    "bunfig.toml": `
[test]
coverageReporter = []
coverageThreshold = { functions = 0.9 }
coverageSkipTestFiles = true
`,
    ...thresholdFixture,
  });

  const { stderr, exitCode } = await runCoverage(dir);
  expect({
    error: stderr.includes("error: Function coverage is below the configured test.coverageThreshold of 90.00%"),
    exitCode,
  }).toEqual({ error: true, exitCode: 1 });
});

test.concurrent("coverageThreshold that is met exits 0 with the lcov reporter", async () => {
  const dir = tempDirWithFiles("cov-threshold-met", {
    "bunfig.toml": `
[test]
coverageThreshold = { lines = 0.25, functions = 0.25 }
coverageSkipTestFiles = true
`,
    ...thresholdFixture,
  });

  const { stderr, exitCode } = await runCoverage(dir, ["--coverage-reporter=lcov"]);
  expect({ stderr: stderr.includes("test.coverageThreshold"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
});

test.concurrent("coverageThreshold accepts the singular key spellings", async () => {
  const dir = tempDirWithFiles("cov-threshold-singular", {
    "bunfig.toml": `
[test]
coverageThreshold = { line = 0.9, function = 0.9 }
coverageSkipTestFiles = true
`,
    ...thresholdFixture,
  });

  const { stderr, exitCode } = await runCoverage(dir);
  expect({
    error: stderr.includes(
      "error: Coverage is below the configured test.coverageThreshold (functions: 90.00%, lines: 90.00%)",
    ),
    exitCode,
  }).toEqual({ error: true, exitCode: 1 });
});

test.concurrent("coverageThreshold only enforces the metrics it names", async () => {
  // 1/2 functions are covered. A lines-only threshold must not enforce a
  // hidden default functions threshold.
  const dir = tempDirWithFiles("cov-threshold-lines-only", {
    "bunfig.toml": `
[test]
coverageThreshold = { lines = 0.25 }
coverageSkipTestFiles = true
`,
    ...thresholdFixture,
  });

  const { stderr, exitCode } = await runCoverage(dir);
  expect({ stderr: stderr.includes("test.coverageThreshold"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
});

test.concurrent("a lines-only coverageThreshold failure names line coverage", async () => {
  const dir = tempDirWithFiles("cov-threshold-lines-only-fail", {
    "bunfig.toml": `
[test]
coverageThreshold = { lines = 0.99 }
coverageSkipTestFiles = true
`,
    ...thresholdFixture,
  });

  const { stderr, exitCode } = await runCoverage(dir);
  expect({
    error: stderr.includes("error: Line coverage is below the configured test.coverageThreshold of 99.00%"),
    exitCode,
  }).toEqual({ error: true, exitCode: 1 });
});

test.concurrent("coverageThreshold rejects unknown keys", async () => {
  const dir = tempDirWithFiles("cov-threshold-unknown-key", {
    "bunfig.toml": `
[test]
coverageThreshold = { branches = 0.9 }
`,
    ...thresholdFixture,
  });

  const { stderr, exitCode } = await runCoverage(dir);
  expect({
    error: stderr.includes('coverageThreshold keys must be "lines", "functions", or "statements"'),
    exitCode,
  }).toEqual({ error: true, exitCode: 1 });
});

test.concurrent("a never-called single-line function is reported as uncovered", async () => {
  const dir = tempDirWithFiles("cov-single-line-fn", {
    "bunfig.toml": `
[test]
coverageSkipTestFiles = true
`,
    "one.ts": `export const covered = (a: number) => a + 1;
export const uncovered = (a: number) => a * 2;
`,
    "one.test.ts": `import { test, expect } from "bun:test";
import { covered } from "./one";
test("covered", () => {
  expect(covered(1)).toBe(2);
});
`,
  });

  const { stderr, exitCode } = await runCoverage(dir);
  expect(stderr).toMatchInlineSnapshot(`
"one.test.ts:
(pass) covered
-----------|---------|---------|-------------------
File       | % Funcs | % Lines | Uncovered Line #s
-----------|---------|---------|-------------------
All files  |   50.00 |   50.00 |
 one.ts    |   50.00 |   50.00 | 2
-----------|---------|---------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file."
`);
  expect(exitCode).toBe(0);

  const { lcov } = await runCoverage(dir, ["--coverage-reporter=lcov"]);
  expect(lcov).toMatchInlineSnapshot(`
"TN:
SF:one.ts
FNF:2
FNH:1
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record"
`);
});

test.concurrent("line hit counts are execution counts and a dead function covers its whole body", async () => {
  const dir = tempDirWithFiles("cov-line-hits", {
    "bunfig.toml": `
[test]
coverageSkipTestFiles = true
`,
    "loop.ts": `export function run(n: number) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += i;
  }
  return total;
}
export function neverCalled() {
  return 42;
}
`,
    "loop.test.ts": `import { test, expect } from "bun:test";
import { run } from "./loop";
test("run", () => {
  expect(run(5)).toBe(10);
});
`,
  });

  const { lcov, exitCode } = await runCoverage(dir, ["--coverage-reporter=lcov"]);
  expect(lcov).toMatchInlineSnapshot(`
"TN:
SF:loop.ts
FNF:2
FNH:1
DA:1,1
DA:2,1
DA:3,5
DA:4,5
DA:5,1
DA:6,1
DA:8,0
DA:9,0
LF:8
LH:6
end_of_record"
`);
  expect(exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - ignore all files", () => {
  const dir = tempDirWithFiles("cov", {
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
