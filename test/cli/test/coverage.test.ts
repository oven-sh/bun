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

/** Runs `bun test --coverage` in `dir` with the text and lcov reporters. */
async function runCoverage(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--coverage-dir=cov"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

  /** The rows of the text table, without the dashed rules. */
  const table = stderr
    .split("\n")
    .filter(line => line.includes(" | "))
    .map(line => line.trimEnd());
  const lcov = readFileSync(path.join(dir, "cov", "lcov.info"), "utf-8");

  /** The text table row for `file` plus the lcov `DA:` records for it. */
  const of = (file: string) => {
    const row = table.find(line => line.startsWith(` ${file} `));
    expect({ stderr, row }).toMatchObject({ row: expect.any(String) });

    const record = lcov.split("end_of_record").find(record => record.includes(`SF:${file}\n`))!;
    const hits: Record<number, number> = {};
    for (const [, line, count] of record.matchAll(/^DA:(\d+),(\d+)$/gm)) {
      hits[Number(line)] = Number(count);
    }
    /** Per source line (1-based): hit, missed, or not an executable line at all. */
    const status = (lineCount: number) =>
      Object.fromEntries(
        Array.from({ length: lineCount }, (_, i) => {
          const line = i + 1;
          return [line, !(line in hits) ? "-" : hits[line] > 0 ? "hit" : "MISSED"];
        }),
      );
    return { row: row!, record, status };
  };
  return { table, of };
}

/** Runs `bun test --coverage` in `dir` and returns the text table row for `file` plus the lcov `DA:` records for it. */
async function coverageOf(dir: string, file: string) {
  return (await runCoverage(dir)).of(file);
}

const skipTestFiles = `[test]\ncoverageSkipTestFiles = true\n`;

test.concurrent("coverage blames the statements that never ran, not the braces around them", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": skipTestFiles,
    "lib.js": `export function earlyReturn(a) {
  if (a > 0) {
    return a;
  }
  return -a;
}
export function untakenElse(a) {
  if (a) {
    return 1;
  } else {
    return 2;
  }
}
export function guarded(f) {
  try {
    return f();
  } catch (e) {
    return e;
  }
}
export function make() {
  return {
    get(n) {
      if (n !== undefined) {
        return n;
      }
      return -1;
    },
  };
}
export function neverCalled(a) {
  // a comment inside a function that never runs
  const b = a + 1;

  return b * 2;
}
export function neverCalledOneLiner() { return 1; }
`,
    "lib.test.js": `import { test, expect } from "bun:test";
import { earlyReturn, untakenElse, guarded, make } from "./lib.js";
test("only the happy paths", () => {
  expect(earlyReturn(2)).toBe(2);
  expect(untakenElse(true)).toBe(1);
  expect(guarded(() => 3)).toBe(3);
  expect(make().get(4)).toBe(4);
});
`,
  });

  const { row, status } = await coverageOf(String(dir), "lib.js");
  expect(row).toBe(" lib.js    |   71.43 |   60.00 | 5,10-11,17-18,27,31,33,35,37");
  expect(status(37)).toEqual({
    1: "hit",
    2: "hit",
    3: "hit",
    4: "-", // `}` closing the if block: the dead block after `return a` starts here
    5: "MISSED",
    6: "-",
    7: "hit",
    8: "hit",
    9: "hit",
    10: "MISSED", // `} else {`
    11: "MISSED",
    12: "-",
    13: "-",
    14: "hit",
    15: "hit",
    16: "hit",
    17: "MISSED", // `} catch (e) {`
    18: "MISSED",
    19: "-",
    20: "-",
    21: "hit",
    22: "hit",
    23: "hit",
    24: "hit",
    25: "hit",
    26: "-",
    27: "MISSED", // `return -1`: the executed `},` after it must not count as this line
    28: "-",
    29: "hit", // `};` ends the executed return statement
    30: "-",
    31: "MISSED", // uncalled function: its declaration line...
    32: "-", // ...but not the comment
    33: "MISSED",
    34: "-", // ...nor the blank line
    35: "MISSED", // ...and its last statement
    36: "-",
    37: "MISSED", // uncalled function written on one line
  });
});

// JSC gives the initializer it synthesizes for class fields a range spanning the whole file and
// cuts it out of the module's top-level block, which then comes back as inverted ranges like
// `[file_length, 0]`. Those used to be walked as `0..file_length`, marking every line of any
// file declaring a class field as executed.
test.concurrent("coverage of a file with class fields still reports its unexecuted lines", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": skipTestFiles,
    "lib.js": `export class WithField {
  count = 0;
}
export function pick(a) {
  if (a) {
    return 1;
  }
  return 2;
}
`,
    "lib.test.js": `import { test, expect } from "bun:test";
import { WithField, pick } from "./lib.js";
test("pick", () => {
  expect(new WithField().count).toBe(0);
  expect(pick(true)).toBe(1);
});
`,
  });

  const { row, record, status } = await coverageOf(String(dir), "lib.js");
  expect(row).toBe(" lib.js    |  100.00 |   85.71 | 8");
  expect(status(9)).toEqual({
    1: "hit",
    2: "hit",
    3: "hit",
    4: "hit",
    5: "hit",
    6: "hit",
    7: "-",
    8: "MISSED",
    9: "-",
  });
  // `pick` is the only function: the constructor JSC synthesizes for `WithField` is not one.
  expect(record).toContain("\nFNF:1\nFNH:1\n");
});

// Shapes from #8290, #7025 and #29691: uncalled methods are reported on their own lines, and the
// constructors JSC synthesizes (base class, class expression, derived class) are neither counted
// as uncalled functions nor charged to the first line of the file.
test.concurrent("coverage of classes counts methods, not synthesized constructors", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": skipTestFiles,
    "classes.js": `export class Base {
  calls = [];
  async consume(event) {
    this.calls.push(event);
  }
  covered() { return 1; }
  another() { return 2; }
}
export const factory = () => class {};
export class Derived extends factory() {}
`,
    // The file from #8290: blank lines and four-space indentation between the members. The
    // uncalled `consume` was reported as `3-5` (shifted onto `calls = []`) and `another` not at all.
    "live.mock.mjs": `export class MockLive {

    calls = []

    async consume(event) {
        this.calls.push({ consume: { event } })
    }

    covered() { return 1 }

    another() { return 2 }
}
`,
    "classes.test.js": `import { test, expect } from "bun:test";
import { Base, Derived } from "./classes.js";
import { MockLive } from "./live.mock.mjs";
test("covered", () => {
  expect(new Base().covered()).toBe(1);
  expect(Derived.name).toBe("Derived");
  expect(new MockLive().covered()).toBe(1);
});
`,
  });

  const { of } = await runCoverage(String(dir));
  const { row, record, status } = of("classes.js");
  // consume, covered, another and factory; covered and factory ran.
  expect(record).toContain("\nFNF:4\nFNH:2\n");
  expect(row).toMatch(/^ classes\.js +\|   50\.00 \| +\d+\.\d\d \| 3-4,7$/);
  expect(status(10)).toMatchObject({
    3: "MISSED",
    4: "MISSED",
    5: "-",
    6: "hit",
    7: "MISSED",
    9: "hit",
    10: "hit",
  });

  const mock = of("live.mock.mjs");
  expect(mock.record).toContain("\nFNF:3\nFNH:1\n");
  expect(mock.row).toMatch(/^ live\.mock\.mjs \|   33\.33 \| +\d+\.\d\d \| 5-6,11$/);
  expect(mock.status(12)).toEqual({
    1: "hit",
    2: "-",
    3: "hit",
    4: "-",
    5: "MISSED",
    6: "MISSED",
    7: "-",
    8: "-",
    9: "hit",
    10: "-",
    11: "MISSED",
    12: "hit",
  });
});

test.concurrent("coverageIgnoreSourcemaps reports the line of the dead statement itself", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `${skipTestFiles}coverageIgnoreSourcemaps = true\n`,
    // Transpiles to itself line for line, so the generated line numbers are the source's.
    "lib.js": `export function earlyReturn(a) {
  if (a > 0) {
    return a;
  }
  return -a;
}
`,
    "lib.test.js": `import { test, expect } from "bun:test";
import { earlyReturn } from "./lib.js";
test("positive", () => {
  expect(earlyReturn(2)).toBe(2);
});
`,
  });

  const { row, status } = await coverageOf(String(dir), "lib.js");
  expect(row).toBe(" lib.js    |  100.00 |   75.00 | 5");
  expect(status(6)).toEqual({
    1: "hit",
    2: "hit",
    3: "hit",
    4: "-",
    5: "MISSED",
    6: "-",
  });
});

// The file from #5307, in TypeScript: the type annotations are stripped, so generated columns
// differ from the source's and every byte goes through the source map. The `return result` that
// the test never reaches was reported as covered, with the column below 100% but empty.
test.concurrent("coverage of a TypeScript file reports the unreached tail of a nested function", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": skipTestFiles,
    "table.ts": `export function make() {
  const cache: Record<number, number> = {}
  return {
    get(n: number) {
      const result = cache[n]
      if (result === undefined) {
        const v = n * 2
        cache[n] = v
        return v
      }
      return result
    },
  }
}
export const table = make()
`,
    "table.test.ts": `import { test, expect } from "bun:test";
import { table } from "./table";
test("get", () => {
  expect(table.get(1)).toBe(2);
  expect(table.get(2)).toBe(4);
});
`,
  });

  const { row, status } = await coverageOf(String(dir), "table.ts");
  expect(row).toBe(" table.ts  |  100.00 |   91.67 | 11");
  expect(status(15)).toEqual({
    1: "hit",
    2: "hit",
    3: "hit",
    4: "hit",
    5: "hit",
    6: "hit",
    7: "hit",
    8: "hit",
    9: "hit",
    10: "-", // `}` closing the if block
    11: "MISSED",
    12: "-", // `},`
    13: "hit", // `}` ends the executed return statement
    14: "-",
    15: "hit",
  });
});

// Every shape of the uncovered-lines column, in TypeScript: a run that starts on line 1 (the old
// reporter used line 0 as "no run yet"), isolated lines, a run followed by an isolated line, and a
// lone line (the old reporter dropped a trailing single-line run, #9008). The classes have no
// constructor of their own, so JSC's synthesized ones must not count as functions (#7025).
test.concurrent("coverage prints every uncovered run and counts no synthesized constructors", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": skipTestFiles,
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
    "line1.ts": `export function miss(): never {
  throw new Error("a");
}
export function also(): never {
  throw new Error("b");
}
export function ok2() { return "ok"; }
`,
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
    "one.ts": `export function only(n: number): string {
  if (n < 0) {
    throw new Error("negative");
  }
  return "ok";
}
`,
    "demo.test.ts": `import { test, expect } from "bun:test";
import { Base, Derived } from "./classes";
import { ok2 } from "./line1";
import { check } from "./many";
import { mix } from "./mix";
import { only } from "./one";
test("paths", () => {
  const d = new Derived();
  d.x = 5;
  expect(d.x).toBe(5);
  expect(d.y).toBe(1);
  expect(new Base().x).toBe(0);
  expect(ok2()).toBe("ok");
  expect(check(0)).toBe("ok");
  expect(mix(2)).toBe("ok");
  expect(only(1)).toBe("ok");
});
`,
  });

  const { table, of } = await runCoverage(String(dir));
  expect(table).toEqual([
    "File        | % Funcs | % Lines | Uncovered Line #s",
    "All files   |   86.67 |   64.00 |",
    " classes.ts |  100.00 |  100.00 |",
    " line1.ts   |   33.33 |   20.00 | 1-2,4-5",
    " many.ts    |  100.00 |   62.50 | 3,6,9",
    " mix.ts     |  100.00 |   62.50 | 3-4,8",
    " one.ts     |  100.00 |   75.00 | 3",
  ]);
  // The getter and the setter; `miss`, `also` and `ok2`.
  expect(of("classes.ts").record).toContain("\nFNF:2\nFNH:2\n");
  expect(of("line1.ts").record).toContain("\nFNF:3\nFNH:1\n");
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
DA:2,10
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
DA:6,41
DA:7,37
DA:8,35
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
