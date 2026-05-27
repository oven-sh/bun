import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDirWithFiles } from "harness";
import { readFileSync } from "node:fs";
import path from "path";

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

// https://github.com/oven-sh/bun/issues/31484
// The lines of an uncalled function must all be reported as `DA:<line>,0`.
// A reset loop used an exclusive range that skipped the function's last line,
// which either left a phantom `hits=1` on it or dropped it from the DA: set
// entirely (depending on statement shape).
test("lcov reports every line of an uncalled function as uncovered", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coverageSkipTestFiles = true
`,
    "lib.ts": `export function greet(name) {
  if (!name) return "Hello, friend!";
  return \`Hello, \${name}!\`;
}

export function farewellSingle(name, formal) {
  return name ? (formal ? "Goodbye, " : "Bye, ") + name : "Bye!";
}

export function farewellTwo(name, formal) {
  const prefix = formal ? "Goodbye" : "Bye";
  return name ? \`\${prefix}, \${name}\` : \`\${prefix}!\`;
}

export function farewellThree(name, formal) {
  const prefix = formal ? "Goodbye" : "Bye";
  const sep = name ? ", " : "!";
  return name ? \`\${prefix}\${sep}\${name}\` : \`\${prefix}\${sep}\`;
}
`,
    "lib.test.ts": `import { test, expect } from "bun:test";
import { greet, farewellSingle, farewellTwo, farewellThree } from "./lib";

void farewellSingle;
void farewellTwo;
void farewellThree;

test("only greet runs", () => {
  expect(greet("Gabe")).toBe("Hello, Gabe!");
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "lcov", "./lib.test.ts"], {
    cwd: dir,
    env: { ...bunEnv },
    stdio: [null, null, "pipe"],
  });

  let lcovContent = readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8");
  lcovContent = normalizeBunSnapshot(lcovContent, dir);

  // greet (lines 1-3) is called; the three farewell* functions are never
  // invoked, so every one of their body lines must be present with a hit
  // count of 0 — including the final line of each function body, which the
  // off-by-one used to drop or mark with a phantom hit.
  expect(lcovContent).toMatchInlineSnapshot(`
"TN:
SF:lib.ts
FNF:4
FNH:1
DA:1,15
DA:2,15
DA:3,25
DA:6,0
DA:7,0
DA:10,0
DA:11,0
DA:12,0
DA:15,0
DA:16,0
DA:17,0
DA:18,0
LF:12
LH:3
end_of_record"
`);
  expect(result.exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/31484
// The text reporter's "Uncovered Line #s" column collapses contiguous
// uncovered lines into `start-end` runs. It tracked the pending run with
// sentinel zeros, which mistook the sentinel for a real line 0 (printing a
// bogus `1-2` for a lone uncovered line 1) and dropped a trailing single-line
// run entirely. Both are fixed by tracking the pending run explicitly.
test("text reporter groups uncovered lines and keeps a trailing single line", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coverageSkipTestFiles = true
`,
    "lib.ts": `export function called() {
  return 1;
}
export function uncalledRun(x) {
  const y = x + 1;
  return y;
}
export class Uncalled {
#field;
}
`,
    "lib.test.ts": `import { test, expect } from "bun:test";
import { called, uncalledRun, Uncalled } from "./lib";
void uncalledRun;
void Uncalled;
test("only called runs", () => {
  expect(called()).toBe(1);
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "./lib.test.ts"], {
    cwd: dir,
    env: { ...bunEnv },
    stdio: [null, null, "pipe"],
  });

  const stderr = normalizeBunSnapshot(result.stderr.toString("utf-8"), dir);

  // uncalledRun spans lines 4-6 (a run) and the Uncalled class constructor is a
  // single uncovered line 8 at the end of the file, so the column must read
  // "4-6,8" — the trailing single line used to be dropped.
  expect(stderr).toMatchInlineSnapshot(`
"lib.test.ts:
(pass) only called runs
-----------|---------|---------|-------------------
File       | % Funcs | % Lines | Uncovered Line #s
-----------|---------|---------|-------------------
All files  |   33.33 |   50.00 |
 lib.ts    |   33.33 |   50.00 | 4-6,8
-----------|---------|---------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});
