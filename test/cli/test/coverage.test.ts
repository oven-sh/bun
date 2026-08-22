import { expect, test } from "bun:test";
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

// https://github.com/oven-sh/bun/issues/9008
// Two bugs made the text table report < 100% with an empty "Uncovered Line #s" column:
//  - the run-collapsing loop used 0 as "no run yet" and only flushed the trailing run
//    when it spanned more than one line, so a lone trailing uncovered line was dropped
//  - JSC's default class constructor was registered against the enclosing source with
//    offsets from its synthetic source string, so any class without an explicit
//    `constructor()` contributed one permanently-unexecuted function
test("coverage reports 100% for fully-exercised classes and prints every uncovered line", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\n`,
    "classes.ts": `export class Base {
  #x = 0;
  get x(): number {
    return this.#x;
  }
  set x(v: number) {
    this.#x = v;
  }
}
export class Derived extends Base {
  y = 1;
}
`,
    // three non-adjacent uncovered lines (3, 6, 9): previously the trailing one was dropped.
    "many.ts": `export function check(n: number): string {
  if (n === 1) {
    throw new Error("one");
  }
  if (n === 2) {
    throw new Error("two");
  }
  if (n === 3) {
    throw new Error("three");
  }
  return "ok";
}
`,
    // exactly one uncovered line (3): previously the column was blank.
    "one.ts": `export function only(n: number): string {
  if (n < 0) {
    throw new Error("negative");
  }
  return "ok";
}
`,
    // a range followed by an isolated line (3-4, then 8).
    "mix.ts": `export function mix(n: number): string {
  if (n === 1) {
    n += 1;
    throw new Error("a");
  }
  const x = n * 2;
  if (x === -1) {
    throw new Error("b");
  }
  return "ok";
}
`,
    // uncovered lines 1 and 4: the old sentinel couldn't tell line index 0 apart from "no run yet".
    "line1.ts": `export function miss(): never {
  throw new Error("a");
}
export function also(): never {
  throw new Error("b");
}
export function ok2() { return "ok"; }
`,
    "demo.test.ts": `import { test, expect } from "bun:test";
import { Base, Derived } from "./classes";
import { check } from "./many";
import { only } from "./one";
import { mix } from "./mix";
import { ok2 } from "./line1";
test("paths", () => {
  const d = new Derived();
  d.x = 5;
  expect(d.x).toBe(5);
  expect(d.y).toBe(1);
  expect(new Base().x).toBe(0);
  expect(check(0)).toBe("ok");
  expect(only(1)).toBe("ok");
  expect(mix(2)).toBe("ok");
  expect(ok2()).toBe("ok");
});
`,
  });

  const result = Bun.spawnSync(
    [bunExe(), "test", "--coverage", "--coverage-reporter", "text", "--coverage-reporter", "lcov"],
    {
      cwd: String(dir),
      env: bunEnv,
      stdio: [null, null, "pipe"],
    },
  );

  const stderr = result.stderr.toString("utf-8");
  const table = stderr
    .split("\n")
    .filter(l => l.includes(" | "))
    .join("\n");
  expect(normalizeBunSnapshot(table, dir)).toMatchInlineSnapshot(`
"File        | % Funcs | % Lines | Uncovered Line #s
All files   |   86.67 |   76.55 |
 classes.ts |  100.00 |  100.00 | 
 line1.ts   |   33.33 |   60.00 | 1,4
 many.ts    |  100.00 |   72.73 | 3,6,9
 mix.ts     |  100.00 |   70.00 | 3-4,8
 one.ts     |  100.00 |   80.00 | 3"
`);

  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const fn = Object.fromEntries(
    [...lcov.matchAll(/^SF:(.+)\nFNF:(\d+)\nFNH:(\d+)/gm)].map(m => [m[1], { found: +m[2], hit: +m[3] }]),
  );
  expect(fn["classes.ts"]).toEqual({ found: 2, hit: 2 });
  expect(fn["line1.ts"]).toEqual({ found: 3, hit: 1 });
  expect(fn["many.ts"]).toEqual({ found: 1, hit: 1 });

  expect(result.exitCode).toBe(0);
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
