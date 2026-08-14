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
 include-me.ts |   50.00 |   66.67 | 
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

/**
 * Runs `bun test --coverage` in `dir` and returns what it reported for `file`: the row of the text
 * reporter, the function counts of the lcov record, and a lookup of line numbers to "hit", "MISSED", or
 * "-" for a line the lcov record does not list as executable at all.
 */
async function coverageReport(dir: string, file: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=text", "--coverage-reporter=lcov", "--coverage-dir=cov"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const row = stderr
    .split("\n")
    .find(line => line.startsWith(` ${file} `))
    ?.trimEnd();
  expect({ stdout, stderr, exitCode, row }).toMatchObject({ exitCode: 0, row: expect.any(String) });

  const record = readFileSync(path.join(dir, "cov", "lcov.info"), "utf-8")
    .split("end_of_record")
    .find(record => record.includes(`SF:${file}\n`))!;
  const functions = {
    found: Number(record.match(/^FNF:(\d+)$/m)![1]),
    hit: Number(record.match(/^FNH:(\d+)$/m)![1]),
  };
  const status: Record<number, "hit" | "MISSED"> = {};
  for (const [, line, hits] of record.matchAll(/^DA:(\d+),(\d+)$/gm)) {
    status[Number(line)] = Number(hits) > 0 ? "hit" : "MISSED";
  }
  return {
    row: row!,
    functions,
    lines: (...numbers: number[]) => Object.fromEntries(numbers.map(line => [line, status[line] ?? "-"])),
  };
}

// JSC synthesizes two functions for a class that are not in the file: one running its instance (or,
// separately, its static) field initializers, and the constructor of a class that declares none. The
// initializer used to be recorded as a function spanning the file from offset 0 for the length of the scope
// that defines the class (in a CommonJS module: the module wrapper, i.e. the whole file), and its own basic
// blocks spanned that whole scope; the default constructor used to be recorded as a function on the first
// characters of the file that never executes. The tests below cover what that did to the report; the
// engine's data is covered by test/js/bun/jsc-stress/fixtures/class-field-initializer-and-default-constructor.js.

test.concurrent("coverage of a CommonJS module with a class that is never instantiated", async () => {
  using dir = tempDir("cov", {
    "lib.js": `function used() {
  return 1;
}
class Unused {
  field = 1;
}
function alsoUsed() {
  return 2;
}
module.exports = { used, alsoUsed, Unused };
`,
    "lib.test.js": `const { test, expect } = require("bun:test");
const { used, alsoUsed } = require("./lib.js");
test("uses the functions, not the class", () => {
  expect(used() + alsoUsed()).toBe(3);
});
`,
  });

  const { row, functions, lines } = await coverageReport(String(dir), "lib.js");
  // Used to be " lib.js | 75.00 | 10.00 | 1-9": the initializer's range covered the whole wrapper and
  // counted as a function that never ran.
  expect(row).toMatch(/^ lib\.js\s+\|\s+100\.00 \|\s+100\.00 \|\s*$/);
  expect(lines(1, 2, 4, 7, 8, 10)).toEqual({ 1: "hit", 2: "hit", 4: "hit", 7: "hit", 8: "hit", 10: "hit" });
  expect(functions.hit).toBe(functions.found);
});

test.concurrent("coverage of a class that is never instantiated, defined inside a function", async () => {
  using dir = tempDir("cov", {
    "lib.js": `export function describe(name) {
  class Description {
    name = name;
  }
  const description = new Description();
  return description.name;
}
export function make() {
  class Unused {
    field = 1;
  }
  return typeof Unused;
}
`,
    "lib.test.js": `import { test, expect } from "bun:test";
import { describe as describeName, make } from "./lib.js";
test("defines both classes, instantiates one", () => {
  expect(describeName("x")).toBe("x");
  expect(make()).toBe("function");
});
`,
  });

  const { row, functions, lines } = await coverageReport(String(dir), "lib.js");
  // Used to be " lib.js | 60.00 | 81.82 | 1-2": Unused's initializer was reported as an uncalled function
  // spanning the first make().length characters of the file, which is where describe() is; Description's
  // initializer counted as a third executed function and the two classes' default constructors as one
  // more that never executes.
  expect(row).toMatch(/^ lib\.js\s+\|\s+100\.00 \|\s+100\.00 \|\s*$/);
  expect(functions).toEqual({ found: 2, hit: 2 });
  expect(lines(1, 2, 3, 5, 6, 8, 9, 10, 12)).toEqual({
    1: "hit",
    2: "hit",
    3: "hit",
    5: "hit",
    6: "hit",
    8: "hit",
    9: "hit",
    10: "hit",
    12: "hit",
  });
});

test.concurrent("coverage of classes that do not declare a constructor", async () => {
  using dir = tempDir("cov", {
    "lib.js": `let made = 0;
export class Base {}
export class Derived extends Base {}
export class Unused {}
export function make() {
  made += 1;
  return [new Base(), new Derived(), made];
}
`,
    "lib.test.js": `import { test, expect } from "bun:test";
import { Base, Derived, make } from "./lib.js";
test("instantiates the base and the derived class", () => {
  expect(make()).toEqual([expect.any(Base), expect.any(Derived), 1]);
});
`,
  });

  const { row, functions, lines } = await coverageReport(String(dir), "lib.js");
  // Used to be " lib.js | 33.33 | 71.43 | 1-3": the constructors JSC synthesizes for Base and Unused (one
  // entry, they have the same offsets) and for Derived were reported as functions that never execute,
  // instantiated or not (#7025), and since their offsets fall on the first lines of the file, those lines
  // were reported as the uncovered bodies of these functions (#29691).
  expect(row).toMatch(/^ lib\.js\s+\|\s+100\.00 \|\s+100\.00 \|\s*$/);
  expect(functions).toEqual({ found: 1, hit: 1 });
  expect(lines(1, 2, 3, 4, 6, 7)).toEqual({ 1: "hit", 2: "hit", 3: "hit", 4: "hit", 6: "hit", 7: "hit" });
});

test.concurrent("coverage does not count a class's field initializer as a function once it has run", async () => {
  using dir = tempDir("cov", {
    "lib.js": `export function make() {
  class WithField {
    constructor() {
      this.made = true;
    }
    field = 1;
  }
  return new WithField();
}
`,
    "lib.test.js": `import { test, expect } from "bun:test";
import { make } from "./lib.js";
test("instantiates", () => {
  expect(make()).toEqual({ made: true, field: 1 });
});
`,
  });

  const { functions } = await coverageReport(String(dir), "lib.js");
  // make() and the constructor. The initializer used to be reported as a third function once it had run.
  expect(functions).toEqual({ found: 2, hit: 2 });
});

test.concurrent(
  "coverage of a module with a class that has a static field still reports the module's dead code",
  async () => {
    using dir = tempDir("cov", {
      "lib.js": `export class WithStatic {
  static count = 0;
}
export function pick(a) {
  if (a) {
    return 1;
  }
  return 2;
}
if (typeof globalThis.__coverage_test_never_set__ === "string") {
  pick(false);
}
`,
      "lib.test.js": `import { test, expect } from "bun:test";
import { pick } from "./lib.js";
test("takes one branch", () => {
  expect(pick(true)).toBe(1);
});
`,
    });

    const { row, functions, lines } = await coverageReport(String(dir), "lib.js");
    // Used to be " lib.js | 50.00 | 100.00 |". The static initializer runs when the class is defined, and
    // its basic block spanned the whole module: the dead pick(false) (and pick()'s untaken path) were
    // reported as executed. The 50% was WithStatic's default constructor, reported as never executing.
    expect(row).not.toMatch(/\|\s+100\.00 \|\s*$/);
    expect(functions).toEqual({ found: 1, hit: 1 });
    expect(lines(1, 2, 4, 5, 6, 10, 11)).toEqual({
      1: "hit",
      2: "hit",
      4: "hit",
      5: "hit",
      6: "hit",
      10: "hit",
      11: "MISSED",
    });
  },
);

test.concurrent(
  "coverage of a function that instantiates a class with a field still reports the function's dead code",
  async () => {
    using dir = tempDir("cov", {
      "lib.js": `export function run(flag) {
  class Counter {
    count = 0;
  }
  const counter = new Counter();
  if (flag) {
    counter.count = 1;
    counter.count = 2;
  }
  return counter;
}
`,
      "lib.test.js": `import { test, expect } from "bun:test";
import { run } from "./lib.js";
test("never takes the branch", () => {
  expect(run(false).count).toBe(0);
});
`,
    });

    const { row, functions, lines } = await coverageReport(String(dir), "lib.js");
    // Used to be " lib.js | 66.67 | 100.00 |": the initializer's basic block spanned all of run(), reporting
    // lines 7-8 as executed, and the functions were run(), the initializer and Counter's default
    // constructor (never reported as executed, although every run() call runs it).
    expect(row).not.toMatch(/\|\s+100\.00 \|\s*$/);
    expect(functions).toEqual({ found: 1, hit: 1 });
    expect(lines(1, 2, 3, 5, 6, 7, 8, 10)).toEqual({
      1: "hit",
      2: "hit",
      3: "hit",
      5: "hit",
      6: "hit",
      7: "MISSED",
      8: "MISSED",
      10: "hit",
    });
  },
);
