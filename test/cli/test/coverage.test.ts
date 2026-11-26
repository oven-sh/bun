import { beforeAll, describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isLinux,
  isWindows,
  libcPathForDlopen,
  MAX_PATH_BYTES,
  normalizeBunSnapshot,
  tempDir,
} from "harness";
import { mkfifo } from "mkfifo";
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "path";
import {
  branches,
  bundled,
  functions,
  lines,
  statements,
  statementsWithExperimentalDecorators,
} from "./coverage-corpus";

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

// https://github.com/oven-sh/bun/issues/17501
test.each([
  ["an older one", "an older report"],
  ["an empty directory", {}],
])("the lcov report takes the place of %s", async (_, older) => {
  using dir = tempDir("cov-replace", {
    "demo.ts": `export function demo() {}\n`,
    "demo.test.ts": `import { test } from "bun:test";\nimport { demo } from "./demo";\ntest("demo", demo);\n`,
    "coverage/lcov.info": older,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(readdirSync(path.join(String(dir), "coverage"))).toEqual(["lcov.info"]);
  expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8")).toContain("SF:demo.ts\n");
  expect(exitCode).toBe(0);
});

test("a backslash separates in --coverage-dir", async () => {
  using dir = tempDir("cov-dir-backslash", {
    "lib.ts": `export const one = () => 1;`,
    "a.test.ts": `import { test } from "bun:test"; import { one } from "./lib"; test("t", () => { one(); });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov", "--coverage-dir=cv\\r", "./a.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("1 pass");
  expect(readdirSync(String(dir)).sort()).toEqual(["a.test.ts", "cv", "lib.ts"]);
  expect(readdirSync(path.join(String(dir), "cv", "r"))).toEqual(["lcov.info"]);
  expect(exitCode).toBe(0);
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

test("coverage leaves out the modules generated for ?worker, ?init and ?inline, and nothing else that has a query", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\n`,
    "echo.ts": `postMessage("started");`,
    "empty.wasm": Buffer.from("0061736d01000000", "hex"),
    "lib.ts": `export const used = () => 1;`,
    "preload.ts": `
      Bun.plugin({
        name: "supplies a module",
        setup(build) {
          build.onLoad({ filter: /\\?supplied$/ }, () => ({ contents: "export const supplied = () => 2;", loader: "ts" }));
        },
      });
    `,
    "generated.test.ts": `
      import { expect, test, vi } from "bun:test";
      import EchoWorker from "./echo.ts?worker";
      import EchoSharedWorker from "./echo.ts?sharedworker";
      import init from "./empty.wasm?init";
      import url from "./empty.wasm?inline";
      import { used } from "./lib.ts?again";
      import { supplied } from "./lib.ts?supplied";
      test("uses them", () => {
        vi.stubGlobal("Worker", class {});
        new EchoWorker();
        expect([used(), supplied(), typeof init, typeof EchoSharedWorker, url]).toEqual([1, 2, "function", "function", "data:application/wasm;base64,AGFzbQEAAAA="]);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--preload", "./preload.ts", "--coverage", "--coverage-reporter=lcov"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("1 pass");
  expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8").match(/^SF:.*$/gm)).toEqual([
    "SF:lib.ts",
    "SF:lib.ts?supplied",
  ]);
  expect(exitCode).toBe(0);
});

// Windows doesn't allow `?` in a file name.
test.skipIf(isWindows)("a file with ? in its name is not left out of coverage: it cannot be loaded", async () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\n`,
    "named.ts": `export const file = "named.ts";`,
    "named.ts?worker": `export const file = "named.ts?worker";`,
    "only?init.ts": `export const file = "only?init.ts";`,
    "names.test.ts": `
      const results = {};
      for (const specifier of ["./named.ts?x", "./only?init.ts", "./only%3Finit.ts", new URL("./only%3Finit.ts", import.meta.url).href]) {
        results[specifier.replace(/^file:.*\\//, "file:")] = await import(specifier).then(({ file }) => file, error => error.code);
      }
      results.glob = Object.keys(import.meta.glob("./named*"));
      results.worker = typeof (await import("./named.ts?worker")).default;
      console.log("@" + JSON.stringify(results));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(
    JSON.parse(
      stdout
        .split("\n")
        .find(line => line.startsWith("@"))!
        .slice(1),
    ),
  ).toEqual({
    "./named.ts?x": "named.ts",
    "./only?init.ts": "ERR_MODULE_NOT_FOUND",
    "./only%3Finit.ts": "ERR_MODULE_NOT_FOUND",
    "file:only%3Finit.ts": "ERR_MODULE_NOT_FOUND",
    glob: ["./named.ts"],
    worker: "function",
  });
  expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8").match(/^SF:.*$/gm)).toEqual([
    "SF:named.ts",
  ]);
  expect(exitCode).toBe(0);
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
---------------|---------|---------|---------|----------|-------------------
File           | % Funcs | % Lines | % Stmts | % Branch | Uncovered Line #s
---------------|---------|---------|---------|----------|-------------------
All files      |  100.00 |  100.00 |  100.00 |   100.00 |
 include-me.ts |  100.00 |  100.00 |  100.00 |   100.00 | 
 test.test.ts  |  100.00 |  100.00 |  100.00 |   100.00 | 
---------------|---------|---------|---------|----------|-------------------

 1 pass
 0 fail
 2 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

test("a directive in a function body is a line of that function", () => {
  using dir = tempDir("cov", {
    "bunfig.toml": `
[test]
coverageSkipTestFiles = true
`,
    "lib.cjs": `"use strict";
function called() {
  "use strict";
  return 1;
}
function notCalled() {
  "use strict";
  return 2;
}
module.exports = { called, notCalled };
`,
    "lib.test.js": `
import { test, expect } from "bun:test";
const { called } = require("./lib.cjs");
test("calls one function", () => {
  expect(called()).toBe(1);
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
"lib.test.js:
(pass) calls one function
-----------|---------|---------|---------|----------|-------------------
File       | % Funcs | % Lines | % Stmts | % Branch | Uncovered Line #s
-----------|---------|---------|---------|----------|-------------------
All files  |   50.00 |   62.50 |   66.66 |   100.00 |
 lib.cjs   |   50.00 |   62.50 |   66.66 |   100.00 | 6-8
-----------|---------|---------|---------|----------|-------------------

 1 pass
 0 fail
 1 expect() calls
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
---------------|---------|---------|---------|----------|-------------------
File           | % Funcs | % Lines | % Stmts | % Branch | Uncovered Line #s
---------------|---------|---------|---------|----------|-------------------
All files      |   66.66 |   75.00 |   80.00 |   100.00 |
 include-me.ts |   50.00 |   50.00 |   50.00 |   100.00 | 6-7
 test.test.ts  |  100.00 |  100.00 |  100.00 |   100.00 | 
---------------|---------|---------|---------|----------|-------------------

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
--------------|---------|---------|---------|----------|-------------------
File          | % Funcs | % Lines | % Stmts | % Branch | Uncovered Line #s
--------------|---------|---------|---------|----------|-------------------
All files     |  100.00 |  100.00 |  100.00 |   100.00 |
 src/main.ts  |  100.00 |  100.00 |  100.00 |   100.00 | 
 test.test.ts |  100.00 |  100.00 |  100.00 |   100.00 | 
--------------|---------|---------|---------|----------|-------------------

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
----------------|---------|---------|---------|----------|-------------------
File            | % Funcs | % Lines | % Stmts | % Branch | Uncovered Line #s
----------------|---------|---------|---------|----------|-------------------
All files       |  100.00 |  100.00 |  100.00 |   100.00 |
 main.test.ts   |  100.00 |  100.00 |  100.00 |   100.00 | 
 src/feature.ts |  100.00 |  100.00 |  100.00 |   100.00 | 
----------------|---------|---------|---------|----------|-------------------

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
FN:2,includeMe
FNF:1
FNH:1
FNDA:1,includeMe
DA:2,1
DA:3,1
LF:2
LH:2
BRF:0
BRH:0
end_of_record
TN:
SF:test.test.ts
FN:6,(anonymous_0)
FNF:1
FNH:1
FNDA:1,(anonymous_0)
DA:6,1
DA:7,1
DA:8,1
DA:9,1
LF:4
LH:4
BRF:0
BRH:0
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
---------------|---------|---------|---------|----------|-------------------
File           | % Funcs | % Lines | % Stmts | % Branch | Uncovered Line #s
---------------|---------|---------|---------|----------|-------------------
All files      |  100.00 |  100.00 |  100.00 |   100.00 |
 include-me.ts |  100.00 |  100.00 |  100.00 |   100.00 | 
 test.test.ts  |  100.00 |  100.00 |  100.00 |   100.00 | 
---------------|---------|---------|---------|----------|-------------------

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
-----------|---------|---------|---------|----------|-------------------
File       | % Funcs | % Lines | % Stmts | % Branch | Uncovered Line #s
-----------|---------|---------|---------|----------|-------------------
All files  |    0.00 |    0.00 |    0.00 |     0.00 |
-----------|---------|---------|---------|----------|-------------------

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file."
`);
  expect(result.exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/39930
// One worker executes count(), the other only imports the module.
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
  expect(record).not.toContain("DA:5,");
  expect(record).toMatch(/LF:4\nLH:4\n/);

  expect(stderr).toMatch(/ subject\.ts +\|( +100\.00 \|){4} \n/);
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
  expect(stderr).toMatch(/ subject\.ts +\|( +100\.00 \|){4} \n/);
  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => r.includes("SF:subject.ts"));
  expect(record).toMatch(/FNF:2\nFNH:2\n/);
  expect(exitCode).toBe(0);
});

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

  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => r.includes("SF:subject.ts"));
  expect(record?.match(/^DA:.*$/gm)).toEqual([
    "DA:1,1",
    "DA:2,1",
    "DA:3,1",
    "DA:4,1",
    "DA:5,1",
    "DA:6,0",
    "DA:7,1",
    "DA:8,1",
    "DA:10,1",
  ]);
  expect(stderr).toContain(" 1 pass");
  expect(exitCode).toBe(0);
});

// Each case has a subject file of its own. Where a case loads its subject twice,
// one load runs the `if` branch and the other runs the `return` after it.
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

  type Row = Record<"functions" | "lines" | "statements" | "branches" | "uncovered", string>;
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
      const [file, functions, lines, statements, branches, uncovered] = line.split("|").map(column => column.trim());
      if (uncovered !== undefined) rows[file] = { functions, lines, statements, branches, uncovered };
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

  const fullyCovered: Row = {
    functions: "100.00",
    lines: "100.00",
    statements: "100.00",
    branches: "100.00",
    uncovered: "",
  };

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
    // The host runs first(), a graph runs second().
    expect(loaded.rows["functions.ts"]).toEqual({
      functions: "66.66",
      lines: "66.66",
      statements: "66.66",
      branches: "100.00",
      uncovered: "7-8",
    });
  });

  test("CommonJS, by a Bun.ModuleGraph alone, reports what the host alone reports", () => {
    expect(oneLoad.rows["cjs-graph-alone.cjs"].uncovered).not.toBe("");
    expect(loaded.rows["cjs-graph-alone.cjs"]).toEqual(oneLoad.rows["cjs-graph-alone.cjs"]);
  });

  // It names a file and brings a text of its own. In a graph it runs under a
  // wrapping SourceProvider, like the graph's load of the file itself.
  test("module._compile() in a Bun.ModuleGraph does not count as a load of the file it names", () => {
    expect(oneLoad.rows["compile-target.cjs"].uncovered).not.toBe("");
    expect(loaded.rows["compile-target.cjs"]).toEqual(oneLoad.rows["compile-target.cjs"]);
  });

  test("a file that changed between two loads reports the last text alone", () => {
    expect(oneLoad.rows["changed.ts"].functions).toBe("50.00");
    expect(loaded.rows["changed.ts"]).toEqual(oneLoad.rows["changed.ts"]);
  });

  test("bun:jsc codeCoverageForFile()", () => {
    expect(JSON.parse(loaded.stdout.split("\n").find(line => line.startsWith("{"))!)).toEqual({
      hostAlone: expect.stringMatching(/host-and-graph\.ts \| +100\.00 \| +75\.00 \| +66\.66 \| +50\.00 \| 3$/),
      both: expect.stringMatching(/host-and-graph\.ts \|( +100\.00 \|){4} $/),
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

// `braces.ts` in `source-positions-corpus.ts` has this for a file that Bun transpiles and reports by its source map.
test.concurrent.each(["// @bun", "// @bun with a source map", "coverageIgnoreSourcemaps"])(
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
    using dir = tempDir("cov-braces", {
      "lib.test.ts": `
        import { expect, test } from "bun:test";
        import { f } from "./lib.js";
        test("f", () => { expect(f()).toEqual({ one: 1 }); });
      `,
      ...(mode === "// @bun"
        ? { "lib.js": "// @bun\n" + lib + "await 0;\nif (false) globalThis.list = [\n  {\n  }\n];\n" }
        : mode === "// @bun with a source map"
          ? { "src/lib.js": lib }
          : { "lib.js": lib, "bunfig.toml": "[test]\ncoverageIgnoreSourcemaps = true\n" }),
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

    const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
    const record = lcov.split("end_of_record").find(r => r.includes("lib.js\n"));
    expect(record).toBeDefined();
    const above = mode === "// @bun" ? 1 : 0;
    const count = (line: number) => record!.match(new RegExp(`^DA:${line + above},(\\d+)$`, "m"))?.[1];
    expect([2, 4, 6, 8, 11, 12].map(count)).toEqual([undefined, "1", "1", undefined, undefined, undefined]);
    if (mode === "// @bun") {
      expect(record).toContain("DA:16,0");
      expect(record).toContain("DA:17,0");
    }
    expect(exitCode).toBe(0);
  },
);

test("the braces of an object are listed when the file comes from the transpiler cache", async () => {
  using dir = tempDir("cov-transpiler-cache", {
    // The cache leaves out a file of less than 4 KB.
    "lib.ts": `export const list = [
  {
    one: 1,
  },
];
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
    const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
    return { record: lcov.split("end_of_record").find(r => r.includes("lib.ts\n")), exitCode };
  };
  // A run that does not take the entry writes it again.
  const written = () =>
    readdirSync(cache).map(name => [name, statSync(path.join(cache, name), { bigint: true }).mtimeNs]);
  const printed = await run();
  const entries = written();
  expect(entries).not.toBeEmpty();
  expect(printed.record).toContain("DA:2,1\n");
  expect(printed.record).toContain("DA:4,1\n");
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
  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const record = lcov.split("end_of_record").find(r => r.includes("lib.ts\n"));
  expect(record!.match(/^DA:.*$/gm)).toEqual([7, 8, 9, 10, 11, 12, 13, 14].map(line => `DA:${line},1`));
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

async function bun(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, ...env },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The rows of the table but for the first, without white space. */
const rowsOf = (stderr: string) =>
  stderr
    .split("\n")
    .filter(line => / \d+\.\d\d \|/.test(line))
    .map(line => line.replaceAll(" ", "").replaceAll("\\", "/"));
/** But for those of the type checker and about `Bun.plugin`, which come where this file is run with `--aot`. */
const messagesOf = (stderr: string) =>
  stderr.split("\n").filter(line => /^(error|warn|note): (?!TS2|TS1\d{3}:|TS100079:)/.test(line));

// The check needs threads at the exit, and waits for them.
const withoutLeakCheck = {
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
  BUN_DESTRUCT_VM_ON_EXIT: undefined,
};

// A build with assertions reports test files unless it is told not to.
const bunfig = (...lines: string[]) => ["[test]", "coverageSkipTestFiles = true", ...lines, ""].join("\n");

const debugId = "0123456789ABCDEF64756E2164756E21";
const built = (code: string) => `// @bun\n${code}\n//# debugId=${debugId}\n`;
const sourceMap = (sources: string[], sourcesContent: (string | null)[], mappings: string) =>
  JSON.stringify({ version: 3, sources, sourcesContent, mappings, debugId, names: [] });

type Kind = "branches" | "statements" | "functions" | "lines";
const unmarked = (text: string) => text.replace(/«.*?»/g, "");
const repeated = (text: string, times: number) => text.replace(/(\d+)»/g, (_, count) => `${count * times}»`);

/** `text` with the entries of a member of `coverage-final.json`. */
function mark(kind: Kind, text: string, file: any) {
  const marks: { line: number; column: number; mark: string }[] = [];
  const add = ({ start }: any, mark: string) => marks.unshift({ ...start, mark });
  if (kind === "statements") for (const key in file.s) add(file.statementMap[key], file.s[key]);
  if (kind === "functions")
    for (const key in file.f)
      add(file.fnMap[key].loc, `${file.fnMap[key].name.replace(`(anonymous_${key})`, "?")} ${file.f[key]}`);
  if (kind === "branches")
    for (const key in file.b) {
      const { loc, locations } = file.branchMap[key];
      locations.forEach((arm: any, index: number) => add(arm.start.line ? arm : loc, file.b[key][index]));
    }
  const lines = text.split("\n");
  for (const { line, column, mark } of marks.sort((a, b) => b.column - a.column)) {
    lines[line - 1] = `${lines[line - 1].slice(0, column)}«${mark}»${lines[line - 1].slice(column)}`;
  }
  return lines.join("\n");
}

/** `text` with the lines of a record of `lcov.info`. */
function markLines(text: string, record: string) {
  const counts = new Map(record.matchAll(/^DA:(\d+),(\d+)$/gm).map(([, line, count]) => [Number(line), `«${count}»`]));
  let line = 0;
  return text.replace(/\r?\n/g, end => (counts.get(++line) ?? "") + end);
}

/** What the reports in `dir` say about `programs`, the first folder of which is the kind of their marks. */
function reported(dir: string, programs: Record<string, string>) {
  const read = (name: string) => readFileSync(path.join(dir, "coverage", name), "utf8");
  const json = JSON.parse(read("coverage-final.json"));
  return mapValues(programs, (text, name) => {
    const [file, kind] = [json[path.join(dir, name)], name.split("/")[0] as Kind];
    if (kind !== "lines") return file && mark(kind, unmarked(text), file);
    return markLines(
      unmarked(text),
      read("lcov.info")
        .split(`SF:${path.normalize(name)}\n`)[1]
        .split("LF:")[0],
    );
  });
}

const mapValues = <T>(object: Record<string, string>, map: (value: string, key: string) => T) =>
  Object.fromEntries(Object.entries(object).map(([key, value]) => [key, map(value, key)]));

describe.concurrent("what is counted", () => {
  const corpus = Object.fromEntries(
    Object.entries({ branches, statements, functions, lines }).flatMap(([kind, programs]) =>
      Object.entries(programs).map(([name, text]) => [`${kind}/${name}`, text.slice(1)]),
    ),
  );
  const javascript = Object.fromEntries(Object.entries(corpus).filter(([name]) => name.endsWith(".js")));
  const each = (programs: object, load: (specifier: string) => string) =>
    Object.keys(programs)
      .map(name => load(`"./${name}"`))
      .join("\n");
  const imports = (programs: object) => each(programs, it => `import ${it};`);

  async function check(
    programs: Record<string, string>,
    others: Record<string, string>,
    { flags = [] as string[], env = {}, times = 1, bom = "" } = {},
  ) {
    using dir = tempDir("cov-corpus", { ...mapValues(programs, text => bom + unmarked(text)), ...others });
    const args = ["test", "--coverage-reporter=json", "--coverage-reporter=lcov", ...flags];
    const { stderr, exitCode } = await bun(String(dir), args, env);
    expect(messagesOf(stderr)).toEqual([]);
    expect(reported(String(dir), programs)).toEqual(mapValues(programs, text => repeated(text, times)));
    expect(exitCode).toBe(0);
  }

  test("imported", () => check(corpus, { "a.test.ts": imports(corpus) }));

  test.each(["", "\uFEFF"])("not loaded, after %j", bom =>
    check(corpus, { "a.test.ts": "" }, { flags: ["--coverage-include=**"], times: 0, bom }),
  );

  test.each(["// @bun\n", "#!/usr/bin/env bun\n// @bun\n"])("%j", pragma => {
    const programs = mapValues(javascript, text => pragma + text);
    return check(programs, { "a.test.ts": imports(programs) });
  });

  test("import()", () => check(corpus, { "a.test.ts": each(corpus, it => `await import(${it});`) }));

  // An `import` reads every export.
  const required = mapValues(corpus, text => text.replace("«1»return 3", "«0»return 3"));
  const requires = (programs: object) => each(programs, it => `require(${it});`);

  test("require()", () => check(required, { "a.test.ts": requires(required) }));

  test("--preload", () =>
    check(corpus, { "a.test.ts": "", "preload.ts": imports(corpus) }, { flags: ["--preload=./preload.ts"] }));

  test.each(["--isolate", "--parallel=2"])("%s", flag => {
    const files = { "a.test.ts": imports(corpus), "b.test.ts": imports(corpus) };
    return check(corpus, files, { flags: [flag], env: { BUN_TEST_PARALLEL_SCALE_MS: "0" }, times: 2 });
  });

  test("in workers", () => {
    const files = {
      "worker.ts": `${imports(javascript)}\npostMessage("loaded");`,
      "a.test.ts": `${imports(javascript)}
        const start = event =>
          new Promise((resolve, onerror) =>
            Object.assign(new Worker("./worker.ts"), { onerror }).addEventListener(event, resolve),
          );
        await start("close");
        await Promise.all([start("message"), start("message")]);`,
    };
    return check(javascript, files, { times: 4 });
  });

  test("by threads at the same time", () => {
    const programs = { "statements/spin.js": `export function spin(i) { «200»while (i--) «200000»continue; }` };
    const files = {
      "worker.ts": `
        import { spin } from "./statements/spin.js";
        onmessage = ({ data: arrived }) => {
          for (let round = 1; round <= 100; round++) {
            Atomics.add(arrived, 0, 1);
            while (Atomics.load(arrived, 0) < 2 * round);
            spin(1000);
          }
          postMessage("done");
        };`,
      "a.test.ts": `
        const arrived = new Int32Array(new SharedArrayBuffer(4));
        const start = () =>
          new Promise((onmessage, onerror) =>
            Object.assign(new Worker("./worker.ts"), { onmessage, onerror }).postMessage(arrived),
          );
        await Promise.all([start(), start()]);`,
    };
    return check(programs, files);
  });

  test.each([
    ["another operator", `exports?.a?.b;`, `exports.a = exports ? «1»1 : «0»2;`],
    ["another statement", `{} exports.a = exports ? 1 : 2;`, `Object(); exports.a = exports ? «1»1 : «0»2;`],
    [
      "another order",
      `exports ? 1 : 2; class A { constructor() { a; } m() { b; } }`,
      `exports ? «1»1 : «0»2; class A { m() { b; } constructor() { a; } }`,
    ],
    ["another value and a comment", `/**/ exports.a = exports ? 3 : 4;`, `exports.a = exports ? «2»1 : «0»2;`],
  ])("a file that had %s when it was loaded before", (_, before, now) => {
    const load = (text: string) => `
      require("node:fs").writeFileSync(file, "${text}");
      delete require.cache[file];
      require(file);`;
    return check(
      { "branches/edited.cjs": now },
      { "a.test.ts": `const file = require.resolve("./branches/edited.cjs");${load(before)}${load(unmarked(now))}` },
    );
  });

  test("an ES module that had another text, which the transpiler prints alike", () => {
    const now = `«1»class A { constructor(public a) {} } «1»export default new A(1);`;
    return check(
      { "statements/edited.ts": now },
      {
        "a.test.ts": `
          const file = require.resolve("./statements/edited.ts");
          for (const text of ["class A { a; constructor(a) { this.a = a; } } export default new A(1);", "${unmarked(now)}"]) {
            await Bun.write(file, text);
            delete require.cache[file];
            require(file);
          }`,
      },
    );
  });

  test("a file that is loaded in two languages", () => {
    const programs = { "statements/both.ts": `«1»Object<((a) => «0»1)>(2);` };
    return check(programs, {
      "a.test.ts": `
        const file = process.cwd() + "/statements/both.ts";
        await import(file);
        await import(file + "?again", { with: { type: "js" } });`,
    });
  });

  describe.each(["--isolate", "--parallel=2"])("%s", flag => {
    test.each([
      ["each time", ["1", "2"]],
      ["the first time", ["'longer'", "0"]],
      ["the second time", ["0", "'longer'"]],
    ])("a file in which a plugin replaces a value %s", (_, values) => {
      const text = `export const id = 0, pick = v => (v ? «1»1 : «1»2);`;
      // They wait for each other, so that one worker does not run both.
      const [a, b] = values.map(
        (value, index) => `
          import { existsSync, writeFileSync } from "node:fs";
          const contents = ${JSON.stringify(unmarked(text).replace("0", value))};
          Bun.plugin({ setup: build => void build.onLoad({ filter: /lib.js$/ }, () => ({ contents, loader: "js" })) });
          require("./branches/lib.js").pick(${index});
          writeFileSync("started-${index}", "");
          while (${flag !== "--isolate"} && !existsSync("started-${1 - index}")) await new Promise(setImmediate);`,
      );
      const options = { flags: [flag], env: { BUN_TEST_PARALLEL_SCALE_MS: "0" } };
      return check({ "branches/lib.js": text }, { "a.test.ts": a, "b.test.ts": b }, options);
    });
  });

  test.each<[string, string, string[]]>([
    ["", "\n", []],
    ["", "\r\n", ["--parallel=2"]],
    ["// @bun\n", "\n", []],
  ])("by the source map of a plugin that adds code after %j, with %j and %j", (pragma, newline, flags) => {
    const programs = mapValues(pragma ? javascript : corpus, text =>
      text
        .replace(/^"use strict";.*/, "")
        .replace(/^(?=.)/gm, "/*é汉🎉*/ ")
        .replaceAll("\n", newline),
    );
    const test = `
      function load({ path }) {
        const [text, loader] = [require("node:fs").readFileSync(path, "utf8"), path.match(/[jt]sx?$/)[0]];
        const added = ${JSON.stringify(pragma)} + "function added(a) { return a ? () => 1 : 2; }\\n";
        const mappings = added.replace(/.*\\n/g, ";") + "AAAA" + text.replace(/.*\\r?\\n/g, ";AACA");
        const map = JSON.stringify({ version: 3, sources: [""], mappings });
        return { contents: added + text + "\\n//# sourceMappingURL=data:application/json;charset=utf-8;base64," + btoa(map), loader };
      }
      Bun.plugin({ setup: build => void build.onLoad({ filter: /(branches|statements|functions|lines).[^/\\\\]+$/ }, load) });
      ${each(programs, it => `await import(process.cwd() + ${it}.slice(1));`)}`;
    return check(programs, { "a.test.ts": test, "b.test.ts": "" }, { flags });
  });

  test("a file that is too large for one message of --parallel", () => {
    const programs = { "branches/large.js": `//${Buffer.alloc(3 << 20, "-")}\nObject ? «1»1 : «0»2;` };
    return check(programs, { "a.test.ts": imports(programs), "b.test.ts": "" }, { flags: ["--parallel=2"] });
  });

  test("CRLF", () => {
    const programs = mapValues(corpus, text => text.replaceAll("\n", "\r\n"));
    return check(programs, { "a.test.ts": imports(programs) });
  });

  test.each(["", "// @bun\n"])("columns are in UTF-16 code units after %j", pragma => {
    const programs = mapValues(pragma ? javascript : corpus, text => pragma + text.replace(/^(?=.)/gm, "/*é汉🎉*/ "));
    return check(programs, { "a.test.ts": imports(programs) }, { bom: pragma ? "" : "\uFEFF" });
  });

  test.each([
    ["the interpreter alone", { BUN_JSC_useJIT: "0" }],
    ["no interpreter", { BUN_JSC_useLLInt: "0" }],
    ["no source maps", { BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS: "1" }],
  ])("with %s", (_, env) => check(corpus, { "a.test.ts": imports(corpus) }, { env }));

  test.each([
    `"experimentalDecorators": true`,
    `"experimentalDecorators": true, "emitDecoratorMetadata": true, "useDefineForClassFields": false`,
  ])("%s", options => {
    const programs = { "statements/decorators.ts": statementsWithExperimentalDecorators };
    return check(programs, {
      "a.test.ts": imports(programs),
      "tsconfig.json": `{ "compilerOptions": { ${options} } }`,
    });
  });

  test.each([
    ["import", corpus, imports],
    ["require()", required, requires],
  ])("from the transpiler cache, by %s", async (_, small, loads) => {
    // It leaves out a file of less than 4 KB.
    const programs = mapValues(small, text => `//${Buffer.alloc(4096, "-")}\n${text}`);
    using cache = tempDir("cov-corpus-cache", {});
    const env = {
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: String(cache),
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };
    const written = () =>
      readdirSync(String(cache)).map(name => statSync(path.join(String(cache), name), { bigint: true }).mtimeNs);
    await check(programs, { "a.test.ts": loads(programs) }, { env });
    const entries = written();
    expect(entries).not.toBeEmpty();
    await check(programs, { "a.test.ts": loads(programs) }, { env });
    expect(written()).toEqual(entries);
  });

  test("with the bytecode of a run without coverage in NODE_COMPILE_CACHE", async () => {
    const programs = {
      "branches/lib.mjs": `export const pick = v => (v ? «1»1 : «0»2);`,
      "branches/lib.cjs": `exports.pick = v => (v ? «1»1 : «0»2);`,
    };
    using dir = tempDir("cov-compile-cache", {
      ...mapValues(programs, unmarked),
      "a.test.ts": each(programs, it => `require(${it}).pick(1);`),
    });
    const env = { NODE_COMPILE_CACHE: path.join(String(dir), "cache"), NODE_DEBUG_NATIVE: "COMPILE_CACHE" };
    const without = await bun(String(dir), ["test"], env);
    expect(messagesOf(without.stderr)).toEqual([]);
    expect(without.exitCode).toBe(0);
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-reporter=json"], env);
    expect(stderr.match(/lib\.\w+(?= was accepted)/g)).toEqual(["lib.mjs", "lib.cjs"]);
    expect(reported(String(dir), programs)).toEqual(programs);
    expect(exitCode).toBe(0);
  });

  // The bundler drops what has no effect.
  const withEffects = Object.fromEntries(Object.entries(javascript).filter(([name]) => !/hints|lines/.test(name)));

  test.each([
    ["--sourcemap=linked", withEffects],
    ["--sourcemap=inline", withEffects],
    ["--sourcemap=external", withEffects],
    ["--sourcemap --minify-syntax", bundled],
  ])("from a bundle with %s", async (flags, programs) => {
    using dir = tempDir("cov-corpus-bundle", {
      ...mapValues(programs, unmarked),
      "entry.js": imports(programs),
      "a.test.ts": `import "./out/entry.js";`,
      "bunfig.toml": bunfig(),
    });
    const built = await bun(String(dir), ["build", "entry.js", "--target=bun", "--outdir=out", ...flags.split(" ")]);
    expect(built.exitCode).toBe(0);
    const reporters = ["json", "lcov", "text"].map(it => `--coverage-reporter=${it}`);
    const { stderr, exitCode } = await bun(String(dir), ["test", ...reporters]);
    expect(reported(String(dir), programs)).toEqual(programs);
    expect(stderr).not.toContain("entry.js");
    expect(exitCode).toBe(0);
  });

  test("from a bundle that is built again with what the first build left out", () => {
    const programs = { "branches/lib.js": `globalThis.a = process.env.ON ? «0»Object() : «2»Array();` };
    return check(programs, {
      "a.test.ts": `
        for (const define of [{ "process.env.ON": "0" }, {}]) {
          const options = { outdir: "out", target: "bun", sourcemap: "inline", define };
          const [{ path }] = (await Bun.build({ entrypoints: ["./branches/lib.js"], ...options })).outputs;
          await import(path + "?" + Object.keys(define));
        }`,
    });
  });

  test("from a bundle that is built again from other files", () => {
    const programs = { "statements/a.js": `«2»Object();`, "statements/b.js": `«2»Object();` };
    return check(programs, {
      "a.test.ts": `
        for (const names of [["a"], ["b"], ["a", "b"]]) {
          const sources = names.map(it => "statements/" + it + ".js");
          const sourcesContent = names.map(() => "Object();");
          const mappings = ";AAAA;ACAA".slice(0, 5 * names.length);
          await Bun.write("bundle.js.map", JSON.stringify({ sources, sourcesContent, mappings, debugId: "${debugId}" }));
          await Bun.write("bundle.js", ["// @bun", ...sourcesContent, "//# debugId=${debugId}"].join("\\n"));
          await import(process.cwd() + "/bundle.js?" + names);
        }`,
    });
  });

  test("from a bundle that has no file", () => {
    const programs = { "branches/lib.js": `export const pick = v => (v ? «1»1 : «1»2);` };
    return check(programs, {
      "a.test.ts": `
        const built = await Bun.build({ entrypoints: ["branches/lib.js"], target: "bun", sourcemap: "inline" });
        const contents = await built.outputs[0].text();
        Bun.plugin({ setup: build => void build.module("made-up", () => ({ contents, loader: "js" })) });
        process.chdir("branches");
        require("made-up").pick(0), require("./branches/lib.js").pick(1);`,
    });
  });

  test("from a bundle without a loop that its source has", () => {
    const programs = { "lines/lib.js": `Object();«1»\nwhile (Object«1»\n.none) Object();\n` };
    return check(programs, {
      "bundle.js": built("Object();"),
      "bundle.js.map": sourceMap(Object.keys(programs), Object.values(programs).map(unmarked), ";AAAA"),
      "a.test.ts": `await import(process.cwd() + "/bundle.js");`,
    });
  });

  test.each([
    ["mjs", built("\nObject();\nif (Object) Object();")],
    ["cjs", built("(function () {\nObject();\nif (Object) Object();\n})").replace("@bun", "@bun @bun-cjs")],
  ])("from a .%s bundle that a second Bun.ModuleGraph loads with more mappings", (extension, bundle) => {
    const programs = { "statements/lib.js": `«2»Object();\n«2»if (Object) «1»Object();` };
    const maps = [";;AAAA", ";;AAAA;AACA"].map(mappings =>
      sourceMap(Object.keys(programs), Object.values(programs).map(unmarked), mappings),
    );
    return check(programs, {
      [`bundle.${extension}`]: bundle,
      "a.test.ts": `
        const graphs = [new Bun.ModuleGraph({}), new Bun.ModuleGraph({})];
        for (const [index, map] of ${JSON.stringify(maps)}.entries()) {
          await Bun.write("bundle.${extension}.map", map);
          await graphs[index].import(process.cwd() + "/bundle.${extension}");
        }`,
    });
  });

  // Without a place: the function in `typeof function () {}`.
  test("JavaScriptCore generates code for every place that the printer marks", async () => {
    using dir = tempDir("cov-corpus-places", {
      ...mapValues(corpus, unmarked),
      "a.test.ts": `
        import { checkCoverageCounters } from "bun:internal-for-testing";
        for (const name of ${JSON.stringify(Object.keys(corpus))}) {
          const [printed, counters, placed, ...offsets] = checkCoverageCounters(require.resolve("./" + name));
          if (placed < counters) console.log(name, counters - placed, "without a place");
          for (const offset of offsets) console.log(name, printed.slice(offset).split("\\n")[0]);
        }`,
    });
    const { stdout, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      functions/functions.ts 1 without a place"
    `);
    expect(exitCode).toBe(0);
  });

  test("code that is optimized", () => {
    const programs = {
      "branches/hot.js": `
        const some = [null, { a: null }, { a: { b: 1 } }];
        function inlined(i) {
          return i % 3 ? «2000»1 : «1000»2;
        }
        function hot(i, given = «1500»inlined) {
          «1»«2999»if (i === 2999) some.length.toString();
          try {
            «30»«2970»if (i % 100 === 0) null.throws;
          } «30»catch {}
          switch (i % 3) {
            «1000»case 0:
            «2000»case 1:
          }
          return «3000»some[i % 3]«2000»?.a«1000»?.b ?? «2000»given;
        }
        for (let i = 0; i < 3000; i++) inlined(i), hot(i, i % 2 ? «1500»inlined : «1500»undefined);
      `,
    };
    const env = { BUN_JSC_jitPolicyScale: "0.0005", BUN_JSC_useConcurrentJIT: "0" };
    return check(programs, { "a.test.ts": imports(programs) }, { env });
  });

  test("code that is thrown away and generated again", () => {
    const programs = { "branches/again.js": `export const pick = v => (v ? «2»1 : «1»2);` };
    return check(programs, {
      "a.test.ts": `
        import inspector from "node:inspector/promises";
        import { pick } from "./branches/again.js";
        pick(1);
        const session = new inspector.Session();
        session.connect();
        await session.post("Profiler.enable");
        await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
        pick(0);
        await session.post("Profiler.stopPreciseCoverage");
        pick(1);`,
    });
  });

  test("a function that is called before its module runs", () => {
    const programs = {
      "branches/cycle.ts": `import "../early.ts";\nexport function hoisted(v: unknown) { return v ? «1»1 : «0»2; }`,
    };
    const early = `import { hoisted } from "./branches/cycle.ts"; hoisted(1);`;
    return check(programs, { "early.ts": early, "a.test.ts": imports(programs) });
  });

  test("a module that throws while it loads", () => {
    const programs = { "statements/throws.ts": `«1»Object(1); «1»null!.a; «0»Object(2);` };
    return check(programs, { "a.test.ts": `await import("./statements/throws.ts").catch(() => {});` });
  });

  test("a file that runs though TypeScript reports a syntax error", () => {
    const programs = { "statements/lib.jsx": `/** @jsxRuntime classic */\n/** @jsx Object */\n«1»<p>></p>;` };
    return check(programs, { "a.test.ts": imports(programs) });
  });

  test("the values of macros and of --define", () => {
    const programs = {
      "branches/values.ts": `
        import { object } from "../macro.ts" with { type: "macro" };
        const OBJECT = object();
        const { list: LIST } = object();
        const all = (v?: unknown) => [«2»v ?? «1»OBJECT, «2»v ?? «1»OBJECT.a, «2»v ?? «1»LIST, v ? «1»DEFINED : «1»DEFINED.a];
        all(), all(1);
      `,
      "branches/define.ts": `globalThis.a = LONG, v => [«0»v ?? «0»1, «0»v ?? «0»1, «0»v ?? «0»1];`,
      "branches/json.ts": `import { json } from "../macro.ts" with { type: "macro" };\nglobalThis.a = json(), v => [«0»v ?? «0»1, «0»v ?? «0»1, «0»v ?? «0»1];`,
    };
    // An item starts at the offset that one `1` has in its file.
    const long = JSON.stringify({ items: Array(100).fill([]) });
    const macro = `
      export const object = () => ({ a: 1, list: [2, 3] });
      export const json = () => Response.json(${long});`;
    const flags = ["--define", `DEFINED={"a":[{}]}`, "--define", `LONG=${long}`];
    // A macro that returns a Response leaks.
    return check(programs, { "macro.ts": macro, "a.test.ts": imports(programs) }, { flags, env: withoutLeakCheck });
  });

  test("a test file whose mocks are hoisted", () => {
    const programs = {
      "statements/a.test.ts": `
        import { test, vi } from "vitest";
        import { value } from "../mocked.ts";
        const { made } = «1»vi.hoisted(() => («1»{ made: 1 }));
        «1»test("a", () => { «1»value; «1»value.toString(); });
        «1»vi.mock("../mocked.ts", () => («1»{ value: made }));
      `,
    };
    const others = { "mocked.ts": "export const value = 0;", "bunfig.toml": "[test]\ncoverageSkipTestFiles = false\n" };
    return check(programs, others);
  });

  test("--react-compiler", () => {
    const programs = {
      "branches/component.jsx": `
        function Component({ items, title = «1»"none" }) {
          «1»«1»if (!items) return <p>{title}</p>;
          const shown = items.filter(item => «2»item«1»?.shown ?? «1»false);
          return <ul title={«1»title && «1»title.trim()}>{shown.length ? «1»shown : «0»<li />}</ul>;
        }
        Component({});
        Component({ items: [null, { shown: true }], title: "some" });
        «0»«1»if (!globalThis.isCompiled) throw new Error("It is not compiled");
      `,
      "statements/inlined.jsx": `
        import { useMemo } from "react";
        function Component({ item }) {
          const first = «1»useMemo(() => «1»[item], [item]);
          const value = «1»useMemo(() => { «1»return [first]; }, [first]);
          const named = «1»useMemo(() => { const list = «1»[value]; «1»list.push(item); «1»return list; }, [value, item]);
          «1»return <p>{named.map(() => { «2»<br />; })}{named.map(() => { «2»<br />; «2»return item; })}</p>;
        }
        «1»Component({});
        const useList = «1»item => «1»useMemo(() => «1»[item], [item]);
        «1»useList();
        const Memoized = «1»() => «2»<br />;
        «1»globalThis.cache = [Symbol.for("react.memo_cache_sentinel")];
        «1»Memoized(), Memoized();
      `,
    };
    const others = {
      "node_modules/react/package.json": `{ "name": "react", "version": "19.0.0" }`,
      "node_modules/react/index.js": `export const useMemo = null;`,
      "node_modules/react/jsx-dev-runtime.js": `export const jsxDEV = () => ({});`,
      "node_modules/react/compiler-runtime.js": `
        globalThis.isCompiled = true;
        export const c = size => globalThis.cache ?? Array(size).fill(Symbol.for("react.memo_cache_sentinel"));`,
      "a.test.ts": imports(programs),
    };
    return check(programs, others, { flags: ["--react-compiler"] });
  });
});

test.concurrent("the code that runs does not change", async () => {
  using dir = tempDir("cov-same-code", {
    "lib.js": `
      export const named = [(() => { let a; a ??= () => {}; return a.name; })(), (({ b = class {} }) => b.name)({})];
      export const text = String(function (a = 1) { return a ? a?.b : a && 2; });
      export const countDown = n => (n ? countDown(n - 1) : "no stack overflow");
      export const catchDown = n => { try { if (n) throw n; } catch { return catchDown(n - 1); } };
      export const keys = Reflect.ownKeys(globalThis).length;
      export { default as textInPackage } from "package";`,
    "node_modules/package/index.js": `export default String(function () { if (false) return true; });`,
    "a.test.js": `import * as lib from "./lib.js"; console.log({ ...lib }, lib.countDown(100_000), lib.catchDown(100_000));`,
  });
  const [plain, covered] = await Promise.all([bun(String(dir), ["test"]), bun(String(dir), ["test", "--coverage"])]);
  expect(plain.stdout).toContain("no stack overflow");
  expect(covered.stdout).toBe(plain.stdout);
  expect(covered.exitCode).toBe(0);
});

test.concurrent("the last tier of the JIT waits for code that is very hot", async () => {
  using dir = tempDir("cov-last-tier", { "a.test.js": "" });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"], { BUN_JSC_dumpOptions: "2" });
  expect(stderr).toContain("thresholdForFTLOptimizeAfterWarmUp=1000000");
  expect(exitCode).toBe(0);
});

describe.concurrent("reporters", () => {
  const files = {
    "bunfig.toml": bunfig(),
    "lib.ts": `export function pick(v?: number) {
  if (v) return 1;
  return v ?? 2;
}
export const never = (v: number) => (v ? 1 : 2);
`,
    "empty.ts": "",
    "a.test.ts": `import { pick } from "./lib.ts"; import "./empty.ts"; pick(0), pick(1);`,
  };
  async function report(reporter: string, name: string, ...flags: string[]) {
    using dir = tempDir("cov-reporters", { ...files, coverage: { [name]: "an older report" } });
    const { stderr, exitCode } = await bun(String(dir), ["test", `--coverage-reporter=${reporter}`, ...flags]);
    expect(rowsOf(stderr)).toEqual([]);
    expect(readdirSync(path.join(String(dir), "coverage"))).toEqual([name]);
    expect(exitCode).toBe(0);
    const text = readFileSync(path.join(String(dir), "coverage", name), "utf8");
    return text.replaceAll(JSON.stringify(String(dir) + path.sep).slice(1, -1), "<dir>/");
  }

  test("text has the lines that ran in part where all ran", async () => {
    using dir = tempDir("cov-reporters", files);
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(rowsOf(stderr)).toEqual([
      "Allfiles|50.00|100.00|80.00|50.00|",
      "empty.ts|100.00|100.00|100.00|100.00|",
      "lib.ts|50.00|100.00|80.00|50.00|3,5",
    ]);
    expect(existsSync(path.join(String(dir), "coverage"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("text has colors", async () => {
    using dir = tempDir("cov-colors", { ...files, "never.ts": "export function f() {}" });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=*.ts"], { FORCE_COLOR: "1" });
    const colors = { 31: "<red>", 32: "<green>", 33: "<yellow>" };
    expect(rowsOf(stderr.replace(/\x1b\[(\d+)m/g, (_, code) => colors[code] ?? "")).slice(1)).toEqual([
      "<green>empty.ts|<green>100.00|<green>100.00|<green>100.00|<green>100.00|",
      "<red>lib.ts|<red>50.00|<green>100.00|<red>80.00|<red>50.00|<yellow>3,<yellow>5",
      "<red>never.ts|<red>0.00|<red>0.00|<green>100.00|<green>100.00|<red>1",
    ]);
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/28620
  test("are empty if there is nothing to cover", async () => {
    using dir = tempDir("cov-nothing", { "bunfig.toml": bunfig(), "a.test.ts": "", "coverage/lcov.info": "older" });
    const flags = ["--coverage-reporter=text", "--coverage-reporter=lcov"];
    const { stderr, exitCode } = await bun(String(dir), ["test", ...flags]);
    expect(rowsOf(stderr)).toEqual(["Allfiles|0.00|0.00|0.00|0.00|"]);
    expect(messagesOf(stderr)).toEqual([]);
    expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8")).toBe("");
    expect(exitCode).toBe(0);
  });

  test("nothing is written or checked if no test file runs", async () => {
    using dir = tempDir("cov-nothing", {
      "bunfig.toml": bunfig(`coverageInclude = "."`, "coverageThreshold = 1"),
      "lib.ts": "export function f() {}",
      "a.test.ts": "",
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov", "--shard=2/2"]);
    expect(messagesOf(stderr)).toEqual([]);
    expect(readdirSync(String(dir))).not.toContain("coverage");
    expect(exitCode).toBe(0);
  });

  test("process.chdir() does not move them", async () => {
    using dir = tempDir("cov-chdir", {
      "bunfig.toml": bunfig(`coveragePathIgnorePatterns = ["src/ignored.ts", "ignored"]`),
      "src/lib.ts": "",
      "src/ignored.ts": "",
      "a.test.ts": `
        process.chdir("src");
        require("./src/lib.ts"), require("./src/ignored.ts");
        for (const name of ["made-up", "ignored"]) {
          Bun.plugin({ setup: build => void build.module(name, () => ({ contents: "Object();", loader: "js" })) });
          require(name);
        }`,
    });
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov"]);
    const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8");
    expect(lcov.match(/^SF:.*$/gm)).toEqual([`SF:${path.join("src", "lib.ts")}`, "SF:made-up"]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("do not wait for reads that a test has left behind", async () => {
    using dir = tempDir("cov-blocked", {
      "bunfig.toml": bunfig(),
      "lib.ts": "",
      "a.test.ts": `
        import "./lib.ts";
        import { openSync, readFile } from "node:fs";
        for (const pipe of ["1", "2"]) {
          readFile(pipe, () => {});
          // Returns when a thread has opened the other end.
          openSync(pipe, "w");
        }`,
    });
    for (const pipe of ["1", "2"]) mkfifo(path.join(String(dir), pipe));
    const env = { ...withoutLeakCheck, UV_THREADPOOL_SIZE: "2" };
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"], env);
    expect(rowsOf(stderr)).toContain("lib.ts|100.00|100.00|100.00|100.00|");
    expect(exitCode).toBe(0);
  });

  const limitTo1 = (resource: "RLIMIT_FSIZE" | "RLIMIT_NPROC") => `
    import { dlopen } from "bun:ffi";
    const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, { setrlimit: { args: ["i32", "ptr"], returns: "i32" } });
    const [RLIMIT_FSIZE, RLIMIT_NPROC] = [1, 6];
    console.log(libc.symbols.setrlimit(${resource}, new BigUint64Array([1n, 1n])));`;

  // The limit is not for root.
  test.skipIf(!isLinux || process.getuid?.() === 0)("are written where no thread can be started", async () => {
    using dir = tempDir("cov-no-thread", {
      "bunfig.toml": bunfig(),
      "lib.ts": "",
      "a.test.ts": `
        import "./lib.ts";
        ${limitTo1("RLIMIT_NPROC")}`,
    });
    const env = { ...withoutLeakCheck, BUN_JSC_numberOfGCMarkers: "1", BUN_JSC_useConcurrentJIT: "0" };
    const { stdout, stderr, exitCode } = await bun(String(dir), ["test", "--coverage"], env);
    expect(stdout).toEndWith("\n0\n");
    expect(rowsOf(stderr)).toContain("lib.ts|100.00|100.00|100.00|100.00|");
    expect(exitCode).toBe(0);
  });

  test("text aligns names by the columns that they take", async () => {
    using dir = tempDir("cov-width", {
      "bunfig.toml": bunfig(),
      "汉汉汉汉汉汉.js": "",
      "a.test.js": `
        import "./汉汉汉汉汉汉.js";
        console.log(require("bun:jsc").codeCoverageForFile(require.resolve("./汉汉汉汉汉汉.js")));`,
    });
    const { stdout, stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(stdout).toContain("汉.js |");
    expect(stderr).toContain("\n 汉汉汉汉汉汉.js |");
    expect(new Set(stderr.match(/^[^|\n]*\|/gm)!.map(it => Bun.stringWidth(it))).size).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("text does not round up to 100", async () => {
    using dir = tempDir("cov-rounding", {
      "bunfig.toml": bunfig(),
      "lib.js": `export const f = () => 0;\n${Buffer.alloc(20_001 * 2, "f;")}`,
      "a.test.js": `import "./lib.js";`,
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(rowsOf(stderr)[1]).toBe("lib.js|0.00|100.00|99.99|100.00|1");
    expect(exitCode).toBe(0);
  });

  test("lcov", async () => {
    expect(await report("lcov", "lcov.info")).toMatchInlineSnapshot(`
      "TN:
      SF:empty.ts
      FNF:0
      FNH:0
      LF:0
      LH:0
      BRF:0
      BRH:0
      end_of_record
      TN:
      SF:lib.ts
      FN:1,pick
      FN:5,never
      FNF:2
      FNH:1
      FNDA:2,pick
      FNDA:0,never
      DA:1,2
      DA:2,2
      DA:3,1
      DA:5,1
      LF:4
      LH:4
      BRDA:2,0,0,1
      BRDA:2,0,1,1
      BRDA:3,1,0,1
      BRDA:3,1,1,0
      BRDA:5,2,0,0
      BRDA:5,2,1,0
      BRF:6
      BRH:3
      end_of_record
      "
    `);
  });

  test("json", async () => {
    expect(await report("json", "coverage-final.json")).toMatchInlineSnapshot(`
      "{"<dir>/empty.ts": {"path":"<dir>/empty.ts","statementMap":{},"fnMap":{},"branchMap":{},"s":{},"f":{},"b":{}}
      ,"<dir>/lib.ts": {"path":"<dir>/lib.ts","statementMap":{"0":{"start":{"line":2,"column":2},"end":{"line":2,"column":18}},"1":{"start":{"line":2,"column":9},"end":{"line":2,"column":18}},"2":{"start":{"line":3,"column":2},"end":{"line":3,"column":16}},"3":{"start":{"line":5,"column":21},"end":{"line":5,"column":47}},"4":{"start":{"line":5,"column":37},"end":{"line":5,"column":46}}},"fnMap":{"0":{"name":"pick","decl":{"start":{"line":1,"column":16},"end":{"line":1,"column":20}},"loc":{"start":{"line":1,"column":33},"end":{"line":4,"column":1}},"line":1},"1":{"name":"never","decl":{"start":{"line":5,"column":21},"end":{"line":5,"column":22}},"loc":{"start":{"line":5,"column":37},"end":{"line":5,"column":46}},"line":5}},"branchMap":{"0":{"loc":{"start":{"line":2,"column":2},"end":{"line":2,"column":18}},"type":"if","locations":[{"start":{"line":2,"column":2},"end":{"line":2,"column":18}},{"start":{},"end":{}}],"line":2},"1":{"loc":{"start":{"line":3,"column":9},"end":{"line":3,"column":15}},"type":"binary-expr","locations":[{"start":{"line":3,"column":9},"end":{"line":3,"column":10}},{"start":{"line":3,"column":14},"end":{"line":3,"column":15}}],"line":3},"2":{"loc":{"start":{"line":5,"column":37},"end":{"line":5,"column":46}},"type":"cond-expr","locations":[{"start":{"line":5,"column":41},"end":{"line":5,"column":42}},{"start":{"line":5,"column":45},"end":{"line":5,"column":46}}],"line":5}},"s":{"0":2,"1":1,"2":1,"3":1,"4":0},"f":{"0":2,"1":0},"b":{"0":[1,1],"1":[1,0],"2":[0,0]}}
      }
      "
    `);
  });

  test("json-summary", async () => {
    expect(await report("json-summary", "coverage-summary.json")).toMatchInlineSnapshot(`
      "{"total": {"functions":{"total":2,"covered":1,"skipped":0,"pct":50},"lines":{"total":4,"covered":4,"skipped":0,"pct":100},"statements":{"total":5,"covered":4,"skipped":0,"pct":80},"branches":{"total":6,"covered":3,"skipped":0,"pct":50}}
      ,"<dir>/empty.ts": {"functions":{"total":0,"covered":0,"skipped":0,"pct":100},"lines":{"total":0,"covered":0,"skipped":0,"pct":100},"statements":{"total":0,"covered":0,"skipped":0,"pct":100},"branches":{"total":0,"covered":0,"skipped":0,"pct":100}}
      ,"<dir>/lib.ts": {"functions":{"total":2,"covered":1,"skipped":0,"pct":50},"lines":{"total":4,"covered":4,"skipped":0,"pct":100},"statements":{"total":5,"covered":4,"skipped":0,"pct":80},"branches":{"total":6,"covered":3,"skipped":0,"pct":50}}
      }
      "
    `);
  });

  test("json without files", async () => {
    expect(await report("json", "coverage-final.json", "--coverage-include=!*.ts")).toBe("{}\n");
  });

  test("json-summary without files", async () => {
    const none = { total: 0, covered: 0, skipped: 0, pct: "Unknown" };
    expect(JSON.parse(await report("json-summary", "coverage-summary.json", "--coverage-include=!*.ts"))).toEqual({
      total: { functions: none, lines: none, statements: none, branches: none },
    });
  });

  // It is what istanbul-lib-coverage merges by.
  test("json has a range for the first arm of each branch, which that of no other has", async () => {
    using dir = tempDir("cov-json-keys", { ...mapValues(branches, unmarked), "a.test.ts": "" });
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=json", "--coverage-include=**"]);
    const json = JSON.parse(readFileSync(path.join(String(dir), "coverage", "coverage-final.json"), "utf8"));
    const keys = Object.values<any>(json).flatMap(file =>
      Object.values<any>(file.branchMap).map(it => path.basename(file.path) + JSON.stringify(it.locations[0])),
    );
    expect(keys.filter((key, index) => key.includes("{}") || keys.indexOf(key) < index)).toEqual([]);
    expect(keys.length).toBeGreaterThan(150);
    expect(exitCode).toBe(0);
  });

  test("json has what Istanbul lacks after what it has", async () => {
    const line = `a ??= b?.c.d; try {} catch {} class A { #e() {} f() {} } /* istanbul ignore if */ if (a || b);`;
    using dir = tempDir("cov-json-order", { "lib.js": line, "a.test.ts": "" });
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=json", "--coverage-include=lib.js"]);
    const [file] = Object.values<any>(await Bun.file(path.join(String(dir), "coverage", "coverage-final.json")).json());
    const text = ({ start, end }: any) => line.slice(start.column, end.column);
    expect({
      branches: Object.values<any>(file.branchMap).map(it => [it.type, text(it.loc), ...it.locations.map(text)]),
      functions: Object.values<any>(file.fnMap).map(it => it.name),
      statements: Object.values(file.statementMap).map(it => text(it).split(" ")[0]),
    }).toEqual({
      branches: [
        ["else", "if (a || b);", "if"],
        ["binary-expr", "a || b", "a", "b"],
        ["logical-assignment", "a ??= b?.c.d", "b?.c.d"],
        ["optional-chain", "?.c.d", "?.c.d"],
        ["catch", "catch", "catch"],
      ],
      functions: ["A.f", "A.#e"],
      statements: ["a", "try", "if", "class"],
    });
    expect(exitCode).toBe(0);
  });

  // genhtml refuses the file otherwise.
  test("lcov has a line for each branch and function, which ran if that did", async () => {
    using dir = tempDir("cov-lcov-lines", {
      ...mapValues({ ...branches, ...functions }, unmarked),
      "lines.js": `
        export function pattern(
          {
            a = 1,
          } = {},
        ) {}
        pattern();
        export const afterBrace = function () {
        }
        || 2;
        export const chain = null
          ?.a;
        export
        function
        split() {}
        split();`,
      "a.test.ts": ["lines.js", ...Object.keys({ ...branches, ...functions })].map(it => `import "./${it}";`).join(""),
    });
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov"]);
    const wrong: string[] = [];
    let checked = 0;
    for (const record of readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8").split("end_of_record")) {
      const lines = new Map(record.matchAll(/^DA:(\d+),(\d+)$/gm).map(([, line, count]) => [line, Number(count)]));
      const calls = new Map(record.matchAll(/^FNDA:(\d+),(.*)$/gm).map(([, count, name]) => [name, count]));
      for (const [entry, line, last] of record.matchAll(/^(?:BRDA|FN):(\d+),(?:\d+,\d+,)?(.*)$/gm)) {
        checked++;
        if (!(lines.get(line)! >= (Number(calls.get(last) ?? last) > 0 ? 1 : 0))) wrong.push(entry);
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(300);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("lcov has a path on one line", async () => {
    using dir = tempDir("cov-lcov-path", { "a\nb\rc.ts": "", "a.test.ts": "", "bunfig.toml": bunfig() });
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov", "--coverage-include=."]);
    expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8")).toStartWith("TN:\nSF:a?b?c.ts\n");
    expect(exitCode).toBe(0);
  });

  test("bunfig.toml names them", async () => {
    using dir = tempDir("cov-reporters", {
      ...files,
      "bunfig.toml": bunfig("coverage = true", `coverageReporter = ["json", "json-summary", "lcov", "text"]`),
    });
    const { stderr, exitCode } = await bun(String(dir), ["test"]);
    expect(rowsOf(stderr)).toHaveLength(3);
    expect(readdirSync(path.join(String(dir), "coverage")).sort()).toEqual([
      "coverage-final.json",
      "coverage-summary.json",
      "lcov.info",
    ]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("leave the mode of their folder to the umask", async () => {
    using dir = tempDir("cov-reporters", { ...files, "a.test.ts": `${files["a.test.ts"]} process.umask(0o002);` });
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov"]);
    expect(statSync(path.join(String(dir), "coverage")).mode & 0o777).toBe(0o775);
    expect(exitCode).toBe(0);
  });

  // Windows doesn't allow `"` in a file name.
  test.skipIf(isWindows)("escape the name of a file", async () => {
    using dir = tempDir("cov-reporters", { 'a"\\b.js': "", "a.test.ts": "" });
    const flags = ["--coverage-reporter=json", "--coverage-reporter=json-summary", "--coverage-include=*.js"];
    const { exitCode } = await bun(String(dir), ["test", ...flags]);
    const read = (name: string) => JSON.parse(readFileSync(path.join(String(dir), "coverage", name), "utf8"));
    const file = path.join(String(dir), 'a"\\b.js');
    expect(read("coverage-final.json")[file].path).toBe(file);
    expect(Object.keys(read("coverage-summary.json"))).toEqual(["total", file]);
    expect(exitCode).toBe(0);
  });

  test("a report that cannot be written fails the run", async () => {
    using dir = tempDir("cov-reporters", { ...files, "coverage": "a file" });
    const flags = ["--coverage-reporter=json", "--coverage-reporter=json-summary", "--coverage-reporter=text"];
    const { stderr, exitCode } = await bun(String(dir), ["test", ...flags]);
    expect(rowsOf(stderr)).toHaveLength(3);
    expect(stderr).toContain("Failed to write coverage-final.json");
    expect(stderr).toContain("Failed to write coverage-summary.json");
    expect(exitCode).toBe(1);
  });

  test.skipIf(!isLinux)("a report that is cut short leaves the older one", async () => {
    using dir = tempDir("cov-reporters", {
      ...files,
      "a.test.ts": `${files["a.test.ts"]} process.on("SIGXFSZ", () => {}); ${limitTo1("RLIMIT_FSIZE")}`,
      "coverage/lcov.info": "an older report",
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov"]);
    expect(stderr).toContain("EFBIG: File too large: Failed to write lcov.info");
    expect(readdirSync(path.join(String(dir), "coverage"))).toEqual(["lcov.info"]);
    expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8")).toBe("an older report");
    expect(exitCode).toBe(1);
  });

  // The child waits for the pipe, which takes less than it prints.
  test.skipIf(isWindows).each([
    ["its warnings", "const = ;", "Failed to parse", "an older report"],
    ["the table", "", "All files", "TN:"],
  ])("a run that is killed while it prints %s leaves no other file", async (_, code, printed, start) => {
    const names = Array.from({ length: 400 }, (_, index) => `${index}.js`.padStart(200, "a"));
    using dir = tempDir("cov-killed", {
      ...Object.fromEntries(names.map(name => [name, code])),
      "a.test.ts": "",
      "coverage/lcov.info": "an older report",
    });
    mkfifo(path.join(String(dir), "pipe"));
    await using pipe = await open(path.join(String(dir), "pipe"), "r+");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--coverage-include=*.js", "--coverage-reporter=lcov", "--coverage-reporter=text"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: pipe.fd,
    });
    for (let stderr = ""; !stderr.includes(printed);) stderr += (await pipe.read(Buffer.alloc(1024))).buffer;
    proc.kill("SIGKILL");
    await proc.exited;
    expect(proc.signalCode).toBe("SIGKILL");
    expect(readdirSync(path.join(String(dir), "coverage"))).toEqual(["lcov.info"]);
    expect(readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8")).toStartWith(start);
  });

  test("a report that is written in parts is whole", async () => {
    const name = Buffer.alloc(9 << 20, "a").toString();
    using dir = tempDir("cov-large", { "a.js": `function ${name}() {}`, "b.js": "", "a.test.ts": "" });
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov", "--coverage-include=*.js"]);
    const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8");
    expect(lcov.replaceAll(name, "a").match(/^(SF|FN|FNDA):.*$/gm)).toEqual([
      "SF:a.js",
      "FN:1,a",
      "FNDA:0,a",
      "SF:b.js",
    ]);
    expect(exitCode).toBe(0);
  });

  test("a report does not take the place of a folder with files", async () => {
    using dir = tempDir("cov-reporters", { ...files, "coverage/lcov.info/kept": "" });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov"]);
    expect(stderr).toContain("Failed to write lcov.info");
    expect(readdirSync(path.join(String(dir), "coverage"))).toEqual(["lcov.info"]);
    expect(readdirSync(path.join(String(dir), "coverage", "lcov.info"))).toEqual(["kept"]);
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("coverageThreshold", () => {
  const below = (what: string, is: string, threshold: number) =>
    `error: Coverage of ${what} is ${is}%, which is below the threshold of ${threshold}%`;
  const above = (what: string, is: number, threshold: number) =>
    `error: The number of uncovered ${what} is ${is}, which is above the threshold of ${threshold}`;
  const unchecked = (pattern: string) =>
    `warn: No file in the coverage report matches "${pattern}", so its thresholds are not checked`;
  const range = "note: A threshold is a number from 0 to 1, such as 0.9 for 90%";
  const keys = `note: The keys are "lines", "functions", "statements", "branches" and "perFile". A glob pattern takes a table of them.`;

  test.each<[string, string[]]>([
    ["0.75", []],
    ["0.76", [below("functions", "75.00", 76)]],
    ["0.9", [below("functions", "75.00", 90), below("lines", "80.00", 90)]],
    ["{ lines = 0.8 }", []],
    ["{ lines = 0.8001 }", [below("lines", "80.00", 80.01)]],
    ["{ functions = 0.75 }", []],
    ["{ statements = 0.88 }", []],
    ["{ statements = 0.89 }", [below("statements", "88.88", 89)]],
    ["{ branches = 0.5 }", []],
    ["{ branches = 0.51 }", [below("branches", "50.00", 51)]],
    ["{ branches = 0.5, perFile = true }", []],
    ["{ functions = 0.75, perFile = false }", []],
    [
      "{ functions = 0.75, branches = 1, perFile = true }",
      [below(`branches in "large.ts"`, "50.00", 100), below(`functions in "small.ts"`, "0.00", 75)],
    ],
    ["80", [below("functions", "75.00", 8000), below("lines", "80.00", 8000), range]],
    ["{ lines = nan }", [below("lines", "80.00", NaN), range]],
    ["{ lines = 0 }", []],
    ["{ lines = -1 }", []],
    ["{ lines = -0.5 }", [above("lines", 1, 0.5)]],
    ["{ branches = -0.5, perFile = true }", [above(`branches in "large.ts"`, 1, 0.5)]],
    [
      "{ line = 1, function = 1 }",
      [`warn: Ignoring "line" in "coverageThreshold"`, `warn: Ignoring "function" in "coverageThreshold"`, keys],
    ],
    // https://github.com/oven-sh/bun/issues/5099
    [`{ "l*" = { lines = 1 } }`, []],
    [`{ "s*" = { lines = 1 } }`, [below(`lines in "s*"`, "0.00", 100)]],
    [`{ "./small.ts" = { lines = -0.5 } }`, [above(`lines in "./small.ts"`, 1, 0.5)]],
    [`{ "." = { lines = 0.8 } }`, []],
    [`{ "." = { lines = 0.8 }, perFile = true }`, []],
    [`{ "." = { lines = 0.8, perFile = true } }`, [below(`lines in "small.ts"`, "0.00", 80)]],
    [`{ "s*" = { lines = 0 }, lines = 0.9 }`, [below("lines", "80.00", 90)]],
    [
      `{ "s*" = { lines = 1 }, "l*" = { branches = 1 } }`,
      [below(`lines in "s*"`, "0.00", 100), below(`branches in "l*"`, "50.00", 100)],
    ],
    [`{ "l*" = { lines = 80 } }`, [below(`lines in "l*"`, "100.00", 8000), range]],
    [`{ "!small.ts" = { lines = 1 } }`, []],
    [`{ "!**/small.ts" = { lines = 1 } }`, []],
    [`{ "!(small).ts" = { lines = 1 } }`, []],
    [`{ "!l*" = { lines = 1 } }`, [below(`lines in "!l*"`, "0.00", 100)]],
    [`{ "!." = { lines = 1 } }`, [unchecked("!.")]],
    [`{ "unloaded.ts" = { lines = 1 } }`, [unchecked("unloaded.ts")]],
    [`{ "unloaded.ts" = { lines = 80 } }`, [unchecked("unloaded.ts"), range]],
    [`{ "scr/**" = { lines = 1 } }`, [`error: No file matches "scr/**" in "coverageThreshold"`]],
    [`{ "s*" = 1 }`, [`warn: Ignoring "s*" in "coverageThreshold"`, keys]],
    [`{ "l*" = { "s*" = { lines = 1 } } }`, [`warn: Ignoring "s*" in "coverageThreshold"`, keys]],
    ["{ global = { lines = 0.9 } }", [below("lines", "80.00", 90)]],
    ["{ global = { global = { lines = 0.9 } } }", [`warn: Ignoring "global" in "coverageThreshold"`, keys]],
  ])("%s", async (threshold, messages) => {
    using dir = tempDir("cov-threshold", {
      "bunfig.toml": bunfig(`coverageThreshold = ${threshold}`),
      "large.ts": `const a = () => 1;\nconst b = () => 2;\nconst c = (v: number) => (v ? a() : 0);\nb(), c(1); b();\n`,
      "small.ts": `export function never() { return 1; }\n`,
      "unloaded.ts": "Object();",
      "a.test.ts": `import "./large.ts"; import "./small.ts";`,
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    // Of all that there is to cover, and not the mean of the rows.
    expect(rowsOf(stderr)[0]).toBe("Allfiles|75.00|80.00|88.88|50.00|");
    expect(messagesOf(stderr)).toEqual(messages);
    expect(exitCode).toBe(messages[0]?.startsWith("error") ? 1 : 0);
  });

  test.each([
    ["--coverage", ["", "a.", "(p", "wa", "no", "--", "Fi", "--", "Al", " l", "--", "er", "", " 1"]],
    ["--dots", [".", "wa", "no", "--", "Fi", "--", "Al", " l", "--", "er", "", "1 "]],
  ])("has its messages around the table with %s", async (flag, starts) => {
    using dir = tempDir("cov-threshold", {
      "bunfig.toml": bunfig("coverageThreshold = { line = 1, lines = 1 }"),
      "lib.ts": `export function never() {}`,
      "a.test.ts": `test("a", () => {});`,
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=lib.ts", flag]);
    expect(stderr.split("\n", starts.length).map(line => line.slice(0, 2))).toEqual(starts);
    expect(exitCode).toBe(1);
  });

  const noFile = `warn: No file is in the coverage report, so "coverageThreshold" is not checked`;
  test.each<[string, string[]]>([
    ["1", [noFile]],
    ["-1", [noFile]],
    ["80", [noFile, range]],
    [`{ "lib.ts" = { lines = 1 } }`, [noFile]],
    ["0", []],
  ])("of %s is said not to be checked if no file is reported", async (threshold, messages) => {
    using dir = tempDir("cov-threshold", {
      "bunfig.toml": bunfig(`coverageThreshold = ${threshold}`),
      "lib.ts": `export function never() {}`,
      "a.test.ts": "",
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(messagesOf(stderr)).toEqual(messages);
    expect(exitCode).toBe(0);
  });

  test.each(["functions", "lines", "statements", "branches"])("for a pattern colors its %s", async key => {
    const code = `export function never(v) { return v ? 1 : 2; }`;
    using dir = tempDir("cov-threshold", {
      "bunfig.toml": bunfig(
        `coverageThreshold = { functions = 0, lines = 0, statements = 0, branches = 0, "a.js" = { ${key} = 1 } }`,
      ),
      "a.js": code,
      "b.js": code,
      "a.test.ts": "",
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=*.js"], { FORCE_COLOR: "1" });
    const cells = ["functions", "lines", "statements", "branches"].map(it => (it === key ? "<red>0.00" : "0.00"));
    expect(rowsOf(stderr.replace(/\x1b\[(\d+)m/g, (_, code) => (code === "31" ? "<red>" : "")))).toEqual([
      "Allfiles|0.00|0.00|0.00|0.00|",
      `<red>a.js|${cells.join("|")}|<red>1`,
      "b.js|0.00|0.00|0.00|0.00|<red>1",
    ]);
    expect(exitCode).toBe(1);
  });
});

// https://github.com/oven-sh/bun/issues/5928
describe.concurrent("coverageInclude", () => {
  const code = `export function f() {}\n`;
  const files = {
    "app/src/loaded.ts": code + "f();",
    "app/src/unloaded.ts": code,
    "app/src/.hidden/unloaded.jsx": code,
    "app/src/generated/unloaded.cjs": "exports.a = 1;",
    "app/src/types.d.ts": "export declare function f(): void;",
    "app/src/data.json": "{}",
    "app/src/notes.txt": "",
    "app/src/LICENSE": "",
    "app/src/.git/hooks/pre-commit.js": code,
    "app/src/other.test.ts": code,
    "app/src/ignored.ts": "/* istanbul ignore file */" + code,
    "app/src/node_modules/package/index.js": code,
    "app/tools/loaded.ts": code + "f();",
    "app/coverage/sorter.js": code,
    "shared/loaded.ts": code + "f();",
    "shared/unloaded.ts": code,
    "app/a.test.ts": `import "./src/loaded.ts"; import "./tools/loaded.ts"; import "../shared/loaded.ts";`,
    "app/b.test.ts": "",
  };
  const linesByFile = (stderr: string) =>
    rowsOf(stderr)
      .slice(1)
      .map(row => row.replace(/\|.*?\|(.*?)\|.*/, " $1"));
  const hidden = "src/.hidden/unloaded.jsx 0.00";
  const generated = "src/generated/unloaded.cjs 0.00";
  const shared = "../shared/loaded.ts 100.00";
  const [loaded, unloaded, tool] = ["src/loaded.ts 100.00", "src/unloaded.ts 0.00", "tools/loaded.ts 100.00"];

  test.each<[string, string[], string[]]>([
    ["", [], [loaded, tool]],
    ["coverageInclude = []", [], [loaded, tool]],
    [`coverageInclude = "src/**"`, [], [hidden, generated, loaded, unloaded]],
    [`coverageInclude = "src"`, [], [hidden, generated, loaded, unloaded]],
    [`coverageInclude = "./src/"`, [], [hidden, generated, loaded, unloaded]],
    [`coverageInclude = "."`, [], [hidden, generated, loaded, unloaded, tool]],
    [`coverageInclude = "./src/*.ts"`, [], [loaded, unloaded]],
    [`coverageInclude = "src/loaded.ts"`, [], [loaded]],
    [`coverageInclude = "**/*.{jsx,cjs}"`, [], [hidden, generated]],
    [`coverageInclude = "{src/generated,tools}/**"`, [], [generated, tool]],
    [`coverageInclude = "src/!(generated)/**"`, [], [hidden]],
    [`coverageInclude = "!(src)/**"`, [], [tool]],
    [`coverageInclude = "!!tools/**"`, [], [tool]],
    [`coverageInclude = ["src/*.ts", "src/un*", "tools"]`, [], [loaded, unloaded, tool]],
    [`coverageInclude = ["!src/generated", "src"]`, [], [hidden, loaded, unloaded]],
    [`coverageInclude = ["!src", "src/loaded.ts", "tools"]`, [], [tool]],
    [`coverageInclude = "!src"`, [], [tool]],
    [`coverageInclude = "!src"`, ["--coverage-dir=tools"], ["coverage/sorter.js 0.00", tool]],
    [`coverageInclude = "!src"`, ["--coverage-dir=."], ["coverage/sorter.js 0.00", tool]],
    [`coverageInclude = "coverage"`, [], ["coverage/sorter.js 0.00"]],
    [`coverageInclude = "src//*.ts"`, [], [loaded, unloaded]],
    [`coverageInclude = "src/*"`, [], [loaded, unloaded]],
    [`coverageInclude = "src/*/"`, [], [hidden, generated]],
    [`coverageInclude = "*/generated"`, [], [generated]],
    [`coverageInclude = "*/loaded.ts"`, [], [loaded, tool]],
    [`coverageInclude = "{tools,none}"`, [], [tool]],
    [`coverageInclude = ["src", "!**/generated"]`, [], [hidden, loaded, unloaded]],
    [`coveragePathIgnorePatterns = "tools"`, [], [loaded, tool]],
    [`coverageInclude = "../shared"`, [], [shared, "../shared/unloaded.ts 0.00"]],
    [`coverageInclude = ["../shared", "!**/un*"]`, [], [shared]],
    [`coverageInclude = "src"\ncoveragePathIgnorePatterns = "**/unloaded.*"`, [], [loaded]],
    [`coverageInclude = "src"`, ["--coverage-include=tools", "--coverage-include", "src/u*"], [unloaded, tool]],
    [`coverageInclude = "src/*.ts"`, ["--parallel=2"], [loaded, unloaded]],
    ["", ["--parallel=2", "--coverage-include=src/*.ts"], [loaded, unloaded]],
  ])("%j %j", async (option, flags, expected) => {
    using dir = tempDir("cov-include", { ...files, "app/bunfig.toml": bunfig(option) });
    const args = ["test", "--coverage", ...flags, "./a.test.ts", "./b.test.ts"];
    const { stderr, exitCode } = await bun(path.join(String(dir), "app"), args);
    expect(linesByFile(stderr)).toEqual(expected);
    expect(messagesOf(stderr)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("an absolute path", async () => {
    using dir = tempDir("cov-include", files);
    const app = path.join(String(dir), "app");
    const include = `--coverage-include=${path.join(app, "src", "unloaded.ts")}`;
    const { stderr, exitCode } = await bun(app, ["test", include, "./a.test.ts"]);
    expect(rowsOf(stderr).slice(1)).toEqual(["src/unloaded.ts|0.00|0.00|100.00|100.00|1"]);
    expect(exitCode).toBe(0);
  });

  test.each<[string, string[], string[]]>([
    ["**", [], ["real/loaded.ts 100.00", "real/unloaded.ts 0.00"]],
    ["in/link", [], ["real/loaded.ts 100.00", "real/unloaded.ts 0.00"]],
    ["in/link/*.ts", [], ["real/loaded.ts 100.00", "real/unloaded.ts 0.00"]],
    ["in/link/loaded.ts", [], ["real/loaded.ts 100.00"]],
    ["!in/link/loaded.ts", [], ["real/unloaded.ts 0.00"]],
    ["*/link/*.ts", [], []],
    ["**", ["--coverage-dir=in/link"], ["real/loaded.ts 100.00"]],
    ["real", ["--preserve-symlinks"], ["in/link/loaded.ts 100.00", "real/unloaded.ts 0.00"]],
  ])("%s %j, for a file that is loaded through a link", async (entry, flags, expected) => {
    using dir = tempDir("cov-include", {
      "real/loaded.ts": code + "f();",
      "real/unloaded.ts": code,
      "in/a.test.ts": `import "./link/loaded.ts";`,
      "bunfig.toml": bunfig(),
    });
    symlinkSync(path.join(String(dir), "real"), path.join(String(dir), "in", "link"), "junction");
    const { stderr, exitCode } = await bun(String(dir), ["test", `--coverage-include=${entry}`, ...flags]);
    expect(linesByFile(stderr)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.each<[string, string[]]>([
    ["app/[id]", ["app/[id]/[slug].ts 0.00", "app/[id]/page.ts 100.00"]],
    ["app/[id]/p*", ["app/[id]/page.ts 100.00"]],
    ["app/[id]/[slug].ts", ["app/[id]/[slug].ts 0.00"]],
    ["!app/[id]", ["app/i/page.ts 0.00"]],
    ["app/[ij]/*", ["app/i/page.ts 0.00"]],
    ["app/\\[id\\]/p*", ["app/[id]/page.ts 100.00"]],
    ["**/\\[slug\\].ts", ["app/[id]/[slug].ts 0.00"]],
    ["*/i/p\\age.ts", ["app/i/page.ts 0.00"]],
  ])("%s, where names have brackets", async (entry, expected) => {
    using dir = tempDir("cov-include", {
      "app/[id]/page.ts": code + "f();",
      "app/[id]/[slug].ts": code,
      "app/i/page.ts": code,
      "a.test.ts": `import "./app/[id]/page.ts";`,
      "bunfig.toml": bunfig(),
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", `--coverage-include=${entry}`]);
    expect(linesByFile(stderr)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["!(group)", "src/!a.ts 0.00"],
    ["src/!*", "src/!a.ts 0.00"],
  ])("%s, where names look like what negates", async (entry, expected) => {
    using dir = tempDir("cov-include", {
      "(group)/a.ts": code,
      "src/!a.ts": code,
      "a.test.ts": "",
      "bunfig.toml": bunfig(),
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", `--coverage-include=${entry}`]);
    expect(linesByFile(stderr)).toEqual([expected]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("the name of a pipe", async () => {
    using dir = tempDir("cov-include", { "a.test.ts": "" });
    mkfifo(path.join(String(dir), "pipe.js"));
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=pipe.js"]);
    expect(messagesOf(stderr)).toEqual([`warn: No file matches the coverage include pattern "pipe.js"`]);
    expect(exitCode).toBe(0);
  });

  test.each<[string[], string[]]>([
    [["*.ts"], ["lib.ts?query 100.00"]],
    [["lib.ts"], ["lib.ts?query 100.00"]],
    [["!l*.ts"], []],
    [["*.ts", "!*query"], ["lib.ts 0.00"]],
  ])("%j, for a file that a plugin loads with a query", async (entries, expected) => {
    using dir = tempDir("cov-include", {
      "lib.ts": code,
      "a.test.ts": `
        const contents = "Object();";
        Bun.plugin({ setup: build => void build.onLoad({ filter: /query$/ }, () => ({ contents, loader: "ts" })) });
        require("./lib.ts?query");`,
      "bunfig.toml": bunfig(`coverageInclude = ${JSON.stringify(entries)}`),
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(linesByFile(stderr)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.each<[string, string[]]>([
    ["made", ["made/loaded.ts 0.00", "made/unloaded.ts 0.00"]],
    ["!made", []],
  ])("%s, for a folder that a test makes", async (entry, expected) => {
    using dir = tempDir("cov-include", {
      "a.test.ts": `
        for (const name of ["loaded", "unloaded"]) await Bun.write("made/" + name + ".ts", ${JSON.stringify(code)});
        await import(process.cwd() + "/made/loaded.ts");`,
      "bunfig.toml": bunfig(),
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", `--coverage-include=${entry}`]);
    expect(linesByFile(stderr)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test("with --parallel, where no worker loads any of the files", async () => {
    using dir = tempDir("cov-include", { "lib.ts": code, "a.test.ts": "", "b.test.ts": "" });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--parallel=2", "--coverage-include=lib.ts"]);
    expect(linesByFile(stderr)).toEqual(["lib.ts 0.00"]);
    expect(exitCode).toBe(0);
  });

  test("a file that is bundled with its test", async () => {
    using dir = tempDir("cov-include", {
      "src/lib.ts": code + "f();",
      "src/a.test.ts": `import "./lib.ts";`,
      "bunfig.toml": bunfig(),
    });
    const built = await bun(String(dir), ["build", "src/a.test.ts", "--target=bun", "--sourcemap", "--outdir=out"]);
    expect(built.exitCode).toBe(0);
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=.", "./out/a.test.js"]);
    expect(linesByFile(stderr)).toEqual(["src/lib.ts 100.00"]);
    expect(exitCode).toBe(0);
  });

  test("a file with a source map that no test loads is left out if Bun would report its sources", async () => {
    const map = sourceMap(["a.js"], [code], "");
    using dir = tempDir("cov-include", {
      "a.js": code,
      "bundle.js": built(code),
      "bundle.js.map": map,
      "emitted.js": built(code).replace("@bun", ""),
      "emitted.js.map": map,
      "a.test.ts": "",
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=*.js"]);
    expect(linesByFile(stderr)).toEqual(["a.js 0.00", "emitted.js 0.00"]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows || process.getuid?.() === 0)("what cannot be read does not hide the rest", async () => {
    using dir = tempDir("cov-include", {
      "src/a/a.ts": code,
      "src/b/b.ts": code,
      "src/c/c.ts": code,
      "src/d.ts": code,
      "a.test.ts": "",
    });
    const locked = [path.join(String(dir), "src", "b"), path.join(String(dir), "src", "d.ts")];
    for (const it of locked) chmodSync(it, 0);
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=src", "./a.test.ts"]);
    chmodSync(locked[0], 0o755);
    expect(messagesOf(stderr)).toEqual(
      locked.map(it => `warn: Failed to read "${it}" (EACCES). It is not in the coverage report.`),
    );
    expect(linesByFile(stderr)).toEqual(["src/a/a.ts 0.00", "src/c/c.ts 0.00"]);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["0.1", 1],
    ["{ branches = 0.1, perFile = true }", 1],
    ["0", 0],
  ])("no file and a threshold of %s", async (value, errors) => {
    using dir = tempDir("cov-include", {
      "a.test.ts": "",
      "bunfig.toml": bunfig(`coverageInclude = "scr"`, `coverageThreshold = ${value}`),
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(messagesOf(stderr)).toEqual([
      `warn: No file matches the coverage include pattern "scr"`,
      ...Array(errors).fill(`error: No file is in the coverage report, so "coverageThreshold" is not met`),
    ]);
    expect(exitCode).toBe(errors);
  });

  test("a file that is not loaded does not run, and counts against a threshold", async () => {
    using dir = tempDir("cov-include", {
      "lib.ts": `console.log("ran");`,
      "a.test.ts": "",
      "bunfig.toml": bunfig(`coverageInclude = "*.ts"`, "coverageThreshold = 0.1"),
    });
    const { stdout, stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(stdout).not.toContain("ran");
    expect(messagesOf(stderr)).toEqual(["error: Coverage of lines is 0.00%, which is below the threshold of 10%"]);
    expect(exitCode).toBe(1);
  });

  test("warns about a pattern that matches nothing and a file that cannot be parsed", async () => {
    using dir = tempDir("cov-include", {
      "broken.ts": "const = ;",
      "broken-deep.ts": Buffer.alloc(200_000, "[").toString(),
      "fine.ts": code,
      "a.test.ts": "",
    });
    const flags = ["--coverage-include=scr/**", "--coverage-include={broken*,fine}.ts"];
    const { stderr, exitCode } = await bun(String(dir), ["test", ...flags]);
    expect(messagesOf(stderr).map(it => it.replace(/".*broken/, `"broken`))).toEqual([
      `warn: No file matches the coverage include pattern "scr/**"`,
      `warn: Failed to parse "broken-deep.ts". It is not in the coverage report.`,
      `warn: Failed to parse "broken.ts". It is not in the coverage report.`,
    ]);
    expect(rowsOf(stderr).slice(1)).toEqual(["fine.ts|0.00|0.00|100.00|100.00|1"]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("what is no source file is not listed", async () => {
  using dir = tempDir("cov-no-source-file", {
    "bunfig.toml": bunfig(),
    "as-text.ts": `export const a = 1;`,
    "data.json": `{}`,
    "style.css": ``,
    "lib.ts": `export const a = 1;`,
    "a.test.ts": `
      import text from "./as-text.ts" with { type: "text" };
      import data from "./data.json";
      import "./lib.ts";
      import "data:text/javascript,export default 1";
      await import(URL.createObjectURL(new Blob(["export default 1"], { type: "text/javascript" })));
      const contents = "export default 1";
      Bun.plugin({ setup: build => void build.onLoad({ filter: /css$/ }, () => ({ contents, loader: "js" })) });
      await import("./style.css");
      Object(text, data);`,
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
  expect(rowsOf(stderr).slice(1)).toEqual(["lib.ts|100.00|100.00|100.00|100.00|"]);
  expect(exitCode).toBe(0);
});

test.concurrent.each(["istanbul", "c8", "v8"])("%s ignore file", async tool => {
  using dir = tempDir("cov-ignore-file", {
    "bunfig.toml": bunfig(),
    "ignored.ts": `// ${tool} ignore file\nexport function f() {}`,
    "kept.ts": `export const text = "/* ${tool} ignore file */";`,
    "a.test.ts": `import "./ignored.ts"; import "./kept.ts";`,
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
  expect(rowsOf(stderr).slice(1)).toEqual(["kept.ts|100.00|100.00|100.00|100.00|"]);
  expect(exitCode).toBe(0);
});

describe.concurrent("a // @bun file is reported as it is", () => {
  const map = (sources: string[], mappings = ";AAAA", firstText: string | null = "export {};") => {
    const sourcesContent = sources.map((_, index) => (index ? "export {};" : firstText));
    return sourceMap(sources, sourcesContent, mappings);
  };

  const [bundle, source] = ["bundle.js|0.00|0.00|0.00|100.00|2-3", "source.ts|100.00|100.00|100.00|100.00|"];

  async function rowsWith(map: string, option: string, test = `await import(process.cwd() + "/bundle.js");`) {
    using dir = tempDir("cov-bundle", {
      "outside.ts": "export {};",
      "app/bunfig.toml": bunfig(option),
      "app/source.ts": "export {};",
      "app/source.svelte": "{#if a}{/if}",
      "app/data.json": "{}",
      "app/folder.ts/file.txt": "",
      "app/node_modules/dependency.ts": "export {};",
      "app/marked.es": "// @bun",
      "app/bundle.js": built("export function f() {\n  return 1;\n}"),
      "app/bundle.js.map": map,
      "app/a.test.ts": test,
    });
    const { stderr, exitCode } = await bun(path.join(String(dir), "app"), ["test", "--coverage"]);
    return { rows: rowsOf(stderr).slice(1), exitCode };
  }

  test.each<[string, string, string?]>([
    ["the files that it was made from are not there", map(["gone.ts"])],
    ["they were outside of the project", map(["../gone.ts"])],
    ["only a dependency is there", map(["gone.ts", "node_modules/dependency.ts"])],
    ["only data is there", map(["gone.ts", "data.json"])],
    ["only a file outside of the project is there", map(["gone.ts", "../outside.ts"])],
    ["only a test file is there", map(["gone.ts", "a.test.ts"])],
    ["the name of a file is there up to a null byte", map(["source.ts\0.ts"])],
    ["the name is that of a folder", map(["folder.ts"])],
    ["the name is empty", map([""])],
    ["the name is its own", map(["bundle.js"])],
    ["the name is that of what a build wrote", map(["marked.es"])],
    ["most are not there, and the rest has another text", map(["source.ts", "a.ts", "b.ts"], ";AAAA", "export { };")],
    ["the name is made up", map(["made-up:a"])],
    ["the name is made up, and the rest is a dependency", map(["made-up:a", "node_modules/dependency.ts"])],
    ["the name is made up, and leads to a file", map(["made-up:a/../source.ts"])],
    ["the text is nested too deeply", map(["source.ts"], ";AAAA", Buffer.alloc(200_000, "[").toString())],
    ["its source map is from another build", map(["source.ts"]).replace("0123", "3210")],
    ["its source map does not say which build it is from", map(["source.ts"]).replace("debugId", "file")],
    ["its source map does not have the text", map(["source.ts"], ";AAAA", null)],
    ["its source map does not have any text", map(["source.ts"]).replace("sourcesContent", "x_texts")],
    ["nothing else is included", map(["source.ts"]), `coverageInclude = "*.js"`],
    ["nothing else is included, and the rest is ignored", map(["source.ts"]), `coverageInclude = ["*.js", "!*.ts"]`],
    ["what else is included is ignored", map(["source.svelte", "source.ts"]), `coverageInclude = ["*s", "!*.ts"]`],
    ["its source map is not JSON", "{"],
    ["its mappings cannot be decoded", map(["source.ts"], ";!")],
    ["source maps are ignored", map(["source.ts"]), "coverageIgnoreSourcemaps = true"],
  ])("if %s", async (_, map, option = "") => {
    expect(await rowsWith(map, option)).toEqual({ rows: [bundle], exitCode: 0 });
  });

  test.each<[string[], string | null, string[]]>([
    [["gone.ts"], "export {};", [bundle, source]],
    [["bundle.js"], "export {};", [bundle, source]],
    [["made-up:a"], "export {};", [bundle, source]],
    [["source.svelte"], "export {};", [bundle, source]],
    [["source.ts"], null, [bundle, source]],
    [["source.ts"], "Object();", [source]],
    [["source.ts?query"], "Object();", [source]],
    [["source.ts", "gone.ts"], "Object();", [source]],
    [["source.ts", "a.ts", "b.ts"], "Object();", [bundle, source]],
  ])("if no test loads it and nothing is listed in its place: %j %j", async (sources, text, rows) => {
    expect(await rowsWith(map(sources, ";AAAA", text), `coverageInclude = "."`, "")).toEqual({ rows, exitCode: 0 });
  });

  test.each<[string[], string]>([
    [["source.ts"], "Object();"],
    [["source.ts?query"], "Object();"],
    [["source.svelte"], "Object();"],
    [["source.svelte"], "<a>></a>"],
    [["marked.es"], "// @bun\nObject();"],
    [["a.ts", "b.ts", "source.ts"], "Object();"],
    [["a.b/go:ne.ts", "source.ts"], "Object();"],
    [["source.ts", "gone.ts"], "Object();"],
  ])("unless its source map fits: %j %j", async (sources, text) => {
    const { rows, exitCode } = await rowsWith(map(sources, ";AAAA", text), "");
    expect(rows.map(it => it.split("|")[0])).toEqual(sources.toSorted());
    expect(exitCode).toBe(0);
  });

  test.each<[string[], string]>([
    [[], ""],
    [["node_modules/dependency.ts"], ""],
    [["node_modules/gone.ts"], ""],
    [["../outside.ts"], ""],
    [["../outside.ts"], `coverageInclude = "!*.ts"`],
    [["source.ts"], `coveragePathIgnorePatterns = "*.ts"`],
    [["gone.ts"], `coveragePathIgnorePatterns = "*.ts"`],
    [["gone.ts", "dataurl:data:text/javascript,"], `coveragePathIgnorePatterns = "*.ts"`],
    [["made-up:a"], `coveragePathIgnorePatterns = "made-up:*"`],
    [["../outside.ts?query"], ""],
    [["../gone.ts"], `coveragePathIgnorePatterns = "../*.ts"`],
    [["source.ts?raw"], ""],
  ])("unless all that it was made from is left out: %j %j", async (sources, option) => {
    expect(await rowsWith(map(sources), option)).toEqual({ rows: [], exitCode: 0 });
  });

  test.each<[string, string]>([
    ["node_modules/dependency.ts", ""],
    ["../gone.ts", ""],
    ["dataurl:data:text/javascript,", ""],
    ["made-up:a", ""],
    ["@made/up:a", ""],
    ["gone.ts", `coverageInclude = ["*.js", "source.ts"]`],
  ])("unless the rest is left out: %j %j", async (name, option) => {
    const { rows, exitCode } = await rowsWith(map(["source.ts", name], ";AAAA", "Object();"), option);
    expect(rows.map(it => it.split("|")[0])).toEqual(["source.ts"]);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["0000", "bundle.js"],
    ["756e", "source.ts"],
  ])("if another tool wrote it: %s in the id", async (part, listed) => {
    using dir = tempDir("cov-bundle", {
      "bunfig.toml": bunfig(),
      "source.ts": "export {};",
      "bundle.js": built("Object();").replace("756E", part),
      "bundle.js.map": map(["source.ts"]).replace("756E", part),
      "a.test.ts": `await import(process.cwd() + "/bundle.js");`,
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(rowsOf(stderr).slice(1)).toEqual([`${listed}|100.00|100.00|100.00|100.00|`]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("if its source map is a pipe", async () => {
    using dir = tempDir("cov-bundle", {
      "loaded.js": built("Object();"),
      "unloaded.js": built("Object();"),
      "a.test.ts": `import "./loaded.js";`,
    });
    for (const name of ["loaded.js.map", "unloaded.js.map"]) mkfifo(path.join(String(dir), name));
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=*.js"]);
    expect(rowsOf(stderr).slice(1)).toEqual([
      "loaded.js|100.00|100.00|100.00|100.00|",
      "unloaded.js|100.00|0.00|0.00|100.00|2",
    ]);
    expect(exitCode).toBe(0);
  });

  test("if a plugin makes it up, and the file of that name has a source map", async () => {
    using dir = tempDir("cov-bundle", {
      "bunfig.toml": bunfig(),
      "source.ts": "export {};",
      "made-up.js.map": map(["source.ts"]),
      "a.test.ts": `
        const contents = ${JSON.stringify(built("Object();"))};
        Bun.plugin({ setup: build => void build.module("made-up.js", () => ({ contents, loader: "js" })) });
        require("made-up.js");`,
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(rowsOf(stderr).slice(1)).toEqual(["made-up.js|100.00|100.00|100.00|100.00|"]);
    expect(exitCode).toBe(0);
  });

  test("without the function around CommonJS, and from its text if it has bytecode", async () => {
    using dir = tempDir("cov-bytecode", {
      "bunfig.toml": bunfig(),
      "lib.cjs": `exports.pick = function (v) { return v ? 1 : 2; };`,
      "a.test.ts": `require("./out/lib.js").pick(1);`,
    });
    const build = await bun(String(dir), ["build", "lib.cjs", "--target=bun", "--bytecode", "--outdir=out"]);
    expect(build.exitCode).toBe(0);
    const { exitCode } = await bun(String(dir), ["test", "--coverage-reporter=lcov"]);
    const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf8");
    expect(lcov).toContain("FNF:1\nFNH:1\nFNDA:1,pick\n");
    expect(lcov).toContain("BRF:2\nBRH:1\n");
    expect(exitCode).toBe(0);
  });
});

test.concurrent.each<[string, string[]]>([
  ["", ["out/unmapped.js", "src/a.js", "src/b.js"]],
  [`coverageInclude = "src/a.js"`, ["src/a.js"]],
  [`coverageInclude = "."`, ["out/unmapped.js", "src/a.js", "src/b.js"]],
  [`coverageInclude = "!out"`, ["src/a.js", "src/b.js"]],
  [`coveragePathIgnorePatterns = "src/a.js"`, ["out/unmapped.js", "src/b.js"]],
  [`coveragePathIgnorePatterns = "out/**"`, []],
])("the files that are listed for a // @bun file, with %j", async (option, listed) => {
  const sources = ["../src/a.js", "../src/b.js", "../node_modules/c/source.js"];
  const sourcesContent = sources.map(() => "Object();");
  using dir = tempDir("cov-bundle", {
    ...Object.fromEntries(sources.map(it => [it.slice(3), "Object();"])),
    "bunfig.toml": bunfig(option),
    "out/mapped.js": built(sourcesContent.join("\n")),
    "out/mapped.js.map": sourceMap(sources, sourcesContent, ";AAAA;ACAA;ACAA"),
    "out/unmapped.js": "// @bun\nObject();\n",
    "node_modules/c/index.js": "// @bun\nObject();\n",
    "a.test.ts": `import "./out/unmapped.js"; import "c"; await import(process.cwd() + "/out/mapped.js");`,
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
  expect(rowsOf(stderr).slice(1)).toEqual(listed.map(it => `${it}|100.00|100.00|100.00|100.00|`));
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["Object();", "a.js|100.00|100.00|100.00|100.00|"],
  ["Array();", "a.js|100.00|0.00|0.00|100.00|1"],
])("a // @bun file in node_modules that was made from %s", async (code, row) => {
  using dir = tempDir("cov-bundle", {
    "a.js": "Object();",
    "node_modules/bundle.js": built(code),
    "node_modules/bundle.js.map": sourceMap(["../a.js"], [code], ";AAAA"),
    "a.test.ts": `await import(process.cwd() + "/node_modules/bundle.js");`,
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage-include=*.js"]);
  expect(rowsOf(stderr).slice(1)).toEqual([row]);
  expect(exitCode).toBe(0);
});

test.concurrent("the sources of a // @bun file are listed wherever it is", async () => {
  using dir = tempDir("cov-bundle", {
    "app/bunfig.toml": bunfig(),
    "app/a.js": "Object();",
    "b.js": "Object();",
    "mapped.js": built("Object();\nObject();"),
    "mapped.js.map": sourceMap(["app/a.js", "b.js"], ["Object();", "Object();"], ";AAAA;ACAA"),
    "unmapped.js": "// @bun\nObject();\n",
    "app/a.test.ts": `import "../unmapped.js"; await import(process.cwd() + "/../mapped.js");`,
  });
  const { stderr, exitCode } = await bun(path.join(String(dir), "app"), ["test", "--coverage"]);
  expect(rowsOf(stderr).slice(1)).toEqual(["a.js|100.00|100.00|100.00|100.00|"]);
  expect(exitCode).toBe(0);
});

describe.concurrent("the files that are listed for what a test builds", () => {
  const code = `export const pick = v => (v ? 1 : 2);\n`;
  const picked = (name: string, line = 1) => `${name}|100.00|100.00|100.00|50.00|${line}`;
  const ran = (name: string) => `${name}|100.00|100.00|100.00|100.00|`;
  const untested = "a.js|0.00|0.00|100.00|100.00|1";

  async function rowsAfter(steps: string, files: Record<string, string>, flags = ["--coverage"]) {
    using dir = tempDir("cov-build", {
      "app": files,
      "app/bunfig.toml": bunfig(),
      "app/b.test.js": "",
      "app/a.test.js": `
        const build = async (entrypoints, options) =>
          (await Bun.build({ entrypoints, target: "bun", sourcemap: "inline", ...options })).outputs[0];
        const load = name => require(process.cwd() + "/" + name).pick?.(1);
        const loadBlob = async blob => (await import(URL.createObjectURL(blob))).pick(1);
        async function loadAs(name, built) {
          const contents = await built.text();
          Bun.plugin({ setup: build => void build.module(name, () => ({ contents, loader: "js" })) });
          require(name).pick(1);
        }
        ${steps}`,
    });
    const { stderr, exitCode } = await bun(path.join(String(dir), "app"), ["test", ...flags]);
    // A build with assertions reports its own modules.
    return { rows: rowsOf(stderr).filter(it => !/^(Allfiles|node:|internal:)/.test(it)), exitCode };
  }

  test.each<[string, string, string]>([
    ["--coverage", `await loadAs("@made/up", await build(["src/a.js"]))`, picked("src/a.js")],
    ["--coverage", `process.chdir("src"), await loadAs("made-up", await build(["a.js"]))`, picked("made-up", 3)],
    ["--coverage-include=*.js", `process.chdir("src"), await loadAs("made-up", await build(["a.js"]))`, untested],
    ["--coverage-include=src", `await loadBlob(await build(["src/a.js"]))`, picked("src/a.js")],
  ])("%s: %s", async (flag, steps, row) => {
    const files = { "a.js": "export function untested() {}", "src/a.js": code };
    expect(await rowsAfter(steps, files, [flag])).toEqual({ rows: [row], exitCode: 0 });
  });

  test.each([[[]], [["--parallel=2"]]])("from a file that it deletes at the end: %j", async flags => {
    const steps = `await build(["a.js"], { outdir: "out" }), load("out/a.js"), await Bun.file("a.js").delete()`;
    expect(await rowsAfter(steps, { "a.js": code }, ["--coverage-include=.", ...flags])).toEqual({
      rows: [picked("a.js")],
      exitCode: 0,
    });
  });

  test.each([
    ["--coverage", "out"],
    ["--coverage", "../out"],
    ["--coverage-include=!out", "out"],
  ])("%s, with a plugin, into %s", async (flag, outdir) => {
    const steps = `
      const load = () => ({ contents: "Object(function (a) { return <number>a; });", loader: "ts" });
      function setup(build) {
        build.onResolve({ filter: /^made-up:/ }, () => ({ path: "a", namespace: "made-up" }));
        build.onLoad({ filter: /./, namespace: "made-up" }, load).onLoad({ filter: /(svelte|b.js)$/ }, load);
      }
      require((await build(["a.js"], { outdir: "${outdir}", plugins: [{ name: "a", setup }] })).path);`;
    const files = {
      "a.js": `/* v8 ignore file */ import "./a.svelte"; import "./b.js"; import "made-up:a";`,
      "a.svelte": "{#if a}{/if}",
      "b.js": "",
    };
    expect(await rowsAfter(`{${steps}}`, files, [flag])).toEqual({
      rows: ["a.svelte|0.00|100.00|50.00|100.00|1", "b.js|0.00|100.00|50.00|100.00|1"],
      exitCode: 0,
    });
  });

  test.each([
    `await build(["a.js"], { plugins, outdir: "out", naming: "b.js" }), load("out/b.js")`,
    `await loadBlob(await build(["a.js"], { plugins }))`,
  ])("with a plugin that it also loads the file with: %s", async buildAndLoad => {
    const steps = `
      const setup = build => void build.onLoad({ filter: /a.js$/ }, () => ({ contents: ${JSON.stringify(code)}, loader: "js" }));
      const plugins = [{ name: "a", setup }];
      Bun.plugin(plugins[0]), require(process.cwd() + "/a.js").pick(0), ${buildAndLoad}`;
    expect(await rowsAfter(steps, { "a.js": "" }, ["--coverage-include=."])).toEqual({
      rows: [ran("a.js")],
      exitCode: 0,
    });
  });

  test.each<[string, string[], string]>([
    ["loadFile(), load('out/a.js')", [], ran("a.svelte")],
    ["load('out/a.js'), loadFile()", [], ran("a.svelte")],
    ["load('out/b.js'), loadFile(), load('out/a.js')", [], ran("a.svelte")],
    ["loadFile(), load('out/a.js')", ["--parallel=2"], ran("a.svelte")],
    ["load('out/a.js'), load('out/b.js')", [], "a.svelte|0.00|100.00|100.00|100.00|1"],
    ["load('out/b.js'), load('out/a.js')", [], "a.svelte|0.00|100.00|100.00|100.00|1"],
    ["load('out/c.js'), load('out/b.js')", [], "a.svelte|0.00|100.00|100.00|100.00|1"],
  ])("with a plugin that makes other code each time: %s %j", async (loads, flags, row) => {
    const steps = `
      const plugin = contents => ({
        name: "a",
        setup: build => void build.onLoad({ filter: /svelte$/ }, () => ({ contents, loader: "js" })),
      });
      const loadFile = () => (Bun.plugin(plugin("Object();")), load("a.svelte"));
      await build(["a.svelte"], { outdir: "out", naming: "a.js", plugins: [plugin("Object(() => {});")] });
      await build(["a.svelte"], { outdir: "out", naming: "b.js", plugins: [plugin("Object();")] });
      await build(["a.svelte"], { outdir: "out", naming: "c.js", plugins: [plugin("Date(); function removed() {}")] });
      ${loads};`;
    expect(await rowsAfter(steps, { "a.svelte": "{#if a}{/if}" }, ["--coverage", ...flags])).toEqual({
      rows: [row],
      exitCode: 0,
    });
  });

  test("and loads with a query that a plugin sees", async () => {
    const steps = `
      const contents = await (await build(["a.js"], { outdir: "out", sourcemap: "linked" })).text();
      Bun.plugin({ setup: build => void build.onLoad({ filter: /query$/ }, () => ({ contents, loader: "js" })) });
      load("out/a.js?a/query");`;
    expect(await rowsAfter(steps, { "a.js": code })).toEqual({ rows: [picked("a.js")], exitCode: 0 });
  });

  test("and loads in place of the entry point", async () => {
    const steps = `
      const contents = await (await build(["src/a.js"])).text();
      Bun.plugin({ setup: build => void build.onLoad({ filter: /a.js$/ }, () => ({ contents, loader: "js" })) });
      load("src/a.js");`;
    const files = { "src/a.js": `export * from "./b.js"; Object();`, "src/b.js": code };
    expect(await rowsAfter(steps, files)).toEqual({ rows: [ran("src/a.js"), picked("src/b.js")], exitCode: 0 });
  });

  test("and appends to", async () => {
    const steps = `await Bun.write("b.js", [await build(["a.js"]), "/* license */"]), load("b.js")`;
    expect(await rowsAfter(steps, { "a.js": code })).toEqual({ rows: [picked("a.js")], exitCode: 0 });
  });

  test("from a text that ends in a source map", async () => {
    const steps = `await build(["a.js"], { outdir: "out", sourcemap: "external" }), load("out/a.js")`;
    const text = `Object(\`\n//# sourceMappingURL=data:application/json,${sourceMap([], [], "")}\n\`);`;
    expect(await rowsAfter(steps, { "a.js": text })).toEqual({ rows: [ran("a.js")], exitCode: 0 });
  });

  test("from files that take a plugin, and loads in part", async () => {
    const steps = `
      const load = async ({ path }) => ({ contents: await Bun.file(path).text(), loader: "js" });
      const plugins = [{ name: "a", setup: build => void build.onLoad({ filter: /svelte$/ }, load) }];
      require((await build(["a.svelte", "b.svelte"], { outdir: "out", plugins })).path);`;
    const files = { "a.svelte": "Object();", "b.svelte": `import "./a.svelte"; Array();` };
    expect(await rowsAfter(`{${steps}}`, files, ["--coverage-include=."])).toEqual({
      rows: [ran("a.svelte"), "out/b.js|100.00|0.00|0.00|100.00|3,6"],
      exitCode: 0,
    });
  });

  test("over its sources, and loads in part", async () => {
    const steps = `await build(["a.js", "b.js"], { outdir: "." }), load("b.js")`;
    const files = { "a.js": `export * from "./b.js"; Object();`, "b.js": code };
    expect(await rowsAfter(steps, files, ["--coverage-include=."])).toEqual({
      rows: ["a.js|0.00|0.00|0.00|0.00|3,6", picked("b.js", 3)],
      exitCode: 0,
    });
  });

  // Windows doesn't allow these in a file name.
  test.skipIf(isWindows).each([
    ["a:b.js", "."],
    ["a\\b.js", "out"],
    ["a.js", "o?t"],
  ])("from %s into %s", async (name, outdir) => {
    const steps = `await loadBlob(Bun.file((await build([process.cwd() + ${JSON.stringify("/" + name)}], { outdir: "${outdir}", naming: "b.js" })).path))`;
    expect(await rowsAfter(steps, { [name]: code })).toEqual({ rows: [picked(name.replace("\\", "/"))], exitCode: 0 });
  });

  test.each([
    ["js", "ts", `export const pick = v => (<any>v ? 1 : 2);`, picked("a.js")],
    [
      "ts",
      "tsx",
      `export const pick = v => (<a>'</a>, v ? 1 : 2); /** @jsxRuntime classic @jsx Object */`,
      picked("a.ts"),
    ],
    [
      "js",
      "tsx",
      `export const pick = (v: any) => (v ? 1 : Object<{\n a: Number,\n}>(2));`,
      "a.js|100.00|50.00|100.00|50.00|3",
    ],
    [
      "es",
      "ts",
      `export const pick = v => (v ? 1 : Object<{\n a: Number,\n}>(2));`,
      "a.es|100.00|50.00|100.00|50.00|3",
    ],
  ])("from a .%s file with the loader %s", async (extension, loader, text, row) => {
    const steps = `await build(["a.${extension}"], { outdir: "out", loader: { ".${extension}": "${loader}" } }), load("out/a.js")`;
    expect(await rowsAfter(steps, { [`a.${extension}`]: text })).toEqual({ rows: [row], exitCode: 0 });
  });

  test.each(["--coverage", "--coverage-include=."])("%s, with a chunk that has only the helpers", async flag => {
    const steps = `await build(["a.cjs", "b.cjs"], { outdir: "out", splitting: true }), load("out/a.js"), load("out/b.js")`;
    const files = { "a.cjs": "module.exports = Object(this);", "b.cjs": "module.exports = Array(this);" };
    expect(await rowsAfter(steps, files, [flag])).toEqual({ rows: [ran("a.cjs"), ran("b.cjs")], exitCode: 0 });
  });
});

describe.concurrent("the source map at the end of what a plugin returns", () => {
  const comment = "\n//# sourceMappingURL=";
  const url = (sources: (string | null)[], mappings: string, sourcesContent?: string[] | null) =>
    "data:application/json;base64," + btoa(JSON.stringify({ version: 3, sources, sourcesContent, mappings }));
  const file = "<a>\n  one two\n  Map)\n</a>\n";
  type Row = [name: string, code: string, url: string, expected: string, text?: string];
  type Show = (report: any, lines: string) => unknown;

  /** Each row has a folder of its name. */
  async function check(rows: Row[], show: Show = (_, lines) => lines, load = "require(file)", option = "") {
    using dir = tempDir("cov-plugin-map", {
      ...Object.fromEntries(rows.map(([name, , , , text = file]) => [name, { "a.svelte": text, "c.svelte": "" }])),
      "code.json": JSON.stringify(Object.fromEntries(rows.map(([name, code, url]) => [name, code + comment + url]))),
      "bunfig.toml": bunfig(`coverageReporter = ["json", "lcov"]`, option),
      "a.svelte": "",
      "b.svelte": "",
      "a.test.js": `
        const made = ({ path }) => ({ contents: require("./code.json")[path.split(/[\\\\/]/).at(-2)], loader: "js" });
        const plugin = { name: "a", setup: build => void build.onLoad({ filter: /svelte/ }, made) };
        Bun.plugin(plugin);
        for (const file of [...new Bun.Glob("*/a.svelte").scanSync({ absolute: true })]) ${load};`,
    });
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    const read = (name: string) => readFileSync(path.join(String(dir), "coverage", name), "utf8");
    const range = ({ start, end }: any) => `${start.line}:${start.column}-${end.line}:${end.column}`;
    const reports = JSON.parse(read("coverage-final.json"), (_, it) => (it.start ? range(it) : it));
    const shown = rows.map(([name]) => {
      const [record] = read("lcov.info").split(`SF:${name}${path.sep}`)[1].split("LF:");
      const warning = new RegExp(`(?<=^warn: The source map for ".*\\W${name}\\W+a.svelte" ).*`, "m");
      const lines = [...(record.match(/(?<=^DA:).*/gm) ?? []), ...(stderr.match(warning) ?? [])].join(" ");
      return [name, String(show(reports[path.join(String(dir), name, "a.svelte")], lines))];
    });
    expect(shown).toEqual(rows.map(it => [it[0], it[3]]));
    expect(exitCode).toBe(0);
  }

  const [toThirdLine, json] = [url(["a.svelte"], ";AAEA"), `{"sources":[""],"mappings":";AAEA"}`];
  const allGive = (expected: string, rows: string[][]) =>
    check(rows.map(([name, url, text]) => [name, "// @bun\nObject();", url, expected, text]));
  const mapped = (rows: Row[], show?: Show, file?: string) =>
    check(
      rows.map(([name, code, it, expected, text = file]) => [
        name,
        code,
        url(["", "node_modules"], it),
        expected,
        text,
      ]),
      show,
    );

  test("is used", () =>
    allGive("3,1", [
      ["from the root", url(["from the root/a.svelte"], ";AAEA")],
      ["with the name of no file", url(["unknown"], ";AAEA", null)],
      ["without a name", url([null], ";AAEA", [])],
      ["with the name of another file and the text of this one", url(["b.svelte"], ";AAEA", [file])],
      ["with two names for the file", url(["a.svelte", "./a.svelte"], ";ACEA")],
      ["with dependencies", url(["../node_modules/a.svelte", "a.svelte"], "AAgBA;ACdA")],
      ["with what esbuild defines", url(["<define:A>", "<stdin>"], "AAgBA;ACdA")],
      ["with a column that is on a later line", url([""], ";AACY")],
      ["as JSON", "data:application/json," + json],
      ["with escapes", "data:application/json;charset=utf-8," + encodeURIComponent(json)],
      ["before other comments", toThirdLine + "\r\n\n  //# sourceURL=a\n"],
      ["for a file that ends in a template", toThirdLine, `${file}\`${comment}data:\``],
      ["for a file that links to a source map", toThirdLine, file + comment + "a.map"],
    ]));

  test.each([
    ["3,1", `require(file + "?a")`, ""],
    [
      "3,1",
      `await Bun.build({ entrypoints: [file], outdir: "out", target: "bun", sourcemap: "linked", plugins: [plugin] }), require(process.cwd() + "/out/a.js")`,
      "",
    ],
    ["2,1", `require(file), await Bun.file(file).delete()`, ""],
    [
      "2,1",
      `Bun.plugin.clearAll(), await Bun.write(file, made({ path: file }).contents), require(file), await Bun.write(file, "1\\n2\\n3")`,
      `[loader]\n".svelte" = "js"`,
    ],
    ["2,1", "require(file)", "coverageIgnoreSourcemaps = true"],
  ])("gives %s after %s %j", (lines, load, option) =>
    check([["a", "// @bun\nObject();", toThirdLine, lines]], undefined, load, option),
  );

  test("is not looked at", () =>
    allGive("2,1", [
      ["the file has one itself", toThirdLine, file + comment + "data:"],
      ["it is not inline", "a.svelte.map"],
      ["code follows", toThirdLine + "\n;"],
    ]));

  test("does not fit", () =>
    allGive("2,1 does not fit. The coverage report has the lines of the code that ran.", [
      ["it is about a file in the root", url(["b.svelte"], ";AAEA")],
      ["it is about a file in the folder", url(["c.svelte"], ";AAEA")],
      ["it is about more files", url(["a.svelte", "unknown"], ";AAEA")],
      ["it is about no file", url([], ";AAEA")],
      ["the file is too short", url(["a.svelte"], "AAKA;AAHA", [file + file])],
      ["its own text is too short", url(["a.svelte"], ";AAEA", [""])],
      ["it has no mappings", "data:application/json,{}"],
      ["it cannot be decoded", url(["a.svelte"], "!")],
      ["it is not JSON", "data:application/json,{"],
      ["it is not base64", "data:application/json;base64,{"],
      ["it has no data", "data:"],
    ]));

  test("leaves nothing", () =>
    allGive("", [
      ["no line is mapped", url([""], ";;")],
      ["all is from a dependency", url(["node_modules/a.js"], ";AAAA")],
      ["it is empty", `data:application/json,{"mappings":""}`],
    ]));

  test("is about the text that it has", () =>
    check([["a", "Map; Set;", url([""], "AACA", ["\nMap; Set;"]), "2:0-2:4,2:5-2:9"]], it =>
      Object.values(it.statementMap),
    ));

  test("gives the lines", () =>
    mapped([
      ["what is around code that did not run", "Object(() => Set, Set, []);", "AAAA,aACE", "1,1 2,0"],
      ["what is before it", "Object(() => Set);", "aACE", "2,0"],
      ["what is mapped like it", "Object(() => Set, Set);", "AAAA,aACE,KAAA", "1,1 2,0"],
      ["what is mapped to the end of it", "Object(() => Set, Set);", "AAAA,aACM,KAAG", "1,1 2,0"],
      ["a parenthesis that is mapped to a word", "Object(Set);", "AAAA,UACE", "1,1"],
      ["a branch around it", "Object(!Set || (() => Set));", "AAAA,sBACE", "1,1 2,0"],
      ["what is in parentheses", "((0, Object))(() => Set);", "AACE,oBAAI", "2,1"],
      ["what is in more of them than the line is long", "((((Set))));", "AAAE", "1,1"],
      ["the same text after a mapping", "Object(() => {}, Map);", "AAAA,eACA", "1,1 2,1", "a\n, Map"],
      ["the same text before a mapping", "Object(() => Set);", "AAAA,aACE,GAAG,CACC", "1,1 2,0 3,1"],
      ["such text that has a mapping itself", "Object(() => Map);", "AAAA,aACE,GACG", "1,1 2,0 3,1"],
      ["no such text on other lines", "Map;\nSet;\nDate;", ";AACA", "2,1", "Map;\nSet;\nDate;"],
      ["what follows a tab that is mapped", "\tObject(() => Set);", "AACE", "2,1"],
      ["a statement without a mapping", "/**/ Object();", "AACE", "2,1"],
      ["a branch without a mapping", "Object(\n/**/ Map ? 1 : 2);", ";AACE", "2,1"],
    ]));

  test("gives the statements", () =>
    mapped(
      [
        ["a mapping at the space before it", "  Map;", "AAEE", "3:2-3:5 1"],
        ["to the space before it", "Map;", "AAEA", "3:2-3:5 1"],
        ["to another word", "Set;", "AACE", "2:2-2:5 1"],
        ["to no word", "Set;", "AAAA", "1:0-1:3 1"],
        ["further on in the line", "Set; Object(Set);", "YACE", "2:2-2:5 1"],
        ["before it and in it", "/**/ Object(Set);", "AACE,YAAI", "2:6-2:9 1"],
        ["at a parenthesis and after it", "(Set);", "AACE,CAAI", "2:2-2:9 1"],
        ["to more of the same text", "Object(() => Map);", "aAEE", "3:2-3:6 1,3:2-3:5 0"],
        ["to the end of the line", "Set;", "AACS", "2:9-2:10 1"],
        ["past the end of its own line", "Set;\nSet;", "eAAA;AACE", "2:2-2:5 1"],
        ["to the end of the file", "Set;", "AAIA", ""],
        ["for its start only", "Object(\n);", "AACE", "2:2-2:5 1"],
        ["for its start and its end", "Object(\n);", "AACE;AACG", "2:2-3:6 1"],
        ["to an end that comes first", "Object(\n);", "AACE;AADF", "2:2-2:9 1"],
        ["to an end in a dependency", "Object(\n);", "AACE;ACoBA", "2:2-2:9 1"],
        ["for its end only", "Object(\n);", ";AACE", ""],
        ["like one in it", "Object(() => Set);", "aACE", "2:2-2:5 0"],
        ["like some after it", "[() => Set, () => Set].map(f => f());", "AAAA,OACE,WAAA", "1:0-2:5 1,2:2-2:5 4"],
      ],
      ({ s, statementMap }) => Object.keys(s).map(it => `${statementMap[it]} ${s[it]}`),
      file.replaceAll("\n", "\r\n"),
    ));

  test("gives the functions", () =>
    mapped(
      [
        ["a mapping after the head", "Object(a =>\n1);", "UACE", "(anonymous_0) 2:2-2:5 2:2-2:5 0"],
        ["one in the other", "function a() { return () => 1; } a();", "AACE", "a 2:2-2:5 2:2-2:5 0"],
        ["one after the other", "[function a() {}, function b() {}][0]();", "AACE", "a 2:2-2:5 2:2-2:5 1"],
        [
          "with other heads",
          "[function a() {}, function b() {}][0]();",
          "UAAA,IACE,aAAI,IAAJ",
          "a 1:0-1:3 2:2-2:5 1,b 2:6-2:9 2:2-2:5 0",
        ],
      ],
      ({ f, fnMap }) => Object.keys(f).map(it => `${fnMap[it].name} ${fnMap[it].decl} ${fnMap[it].loc} ${f[it]}`),
    ));

  test("gives the branches", () =>
    mapped(
      [
        ["one start", "Object(Map && Set ? 1 : 2);", "OAAA", "cond-expr 1,0,binary-expr 1,1"],
        ["one range", "Object(Date ? 1 : 2);\nif (Date) Date;", "AAAA;AAAA", "cond-expr 1,0,if 1,0"],
        ["the same arms", "void [Date ? 3 : 4,\nDate ? 3 : 4];", "MAAA,OAAc;AAAP,OAAO", "cond-expr 1,0,cond-expr 1,0"],
        ["a copy", "if (Date) Date;\nif (!Date) Date;", "AAAA;AAAA", "if 1,1"],
        ["what Istanbul lacks", "Object(Date ?? 1, Date ??= 1);", "AAAA", "binary-expr 1,0"],
        ["with a mapping", "Object(Date ?? 1, Date ??= 1);", "AAAA,kBAAO", "binary-expr 1,0,logical-assignment 0"],
      ],
      ({ b, branchMap }) => Object.keys(b).map(it => `${branchMap[it].type} ${b[it]}`),
      "Map && Set ? 1 : 2",
    ));

  test("gives the arms", () =>
    mapped(
      [
        ["without a mapping", "Object(Set\n? 1\n: 2);", "AACM", "2:6-2:9,2:6-2:9"],
        ["not written", "if (Set) Set;", "AACM", "2:6-2:9,undefined:undefined-undefined:undefined"],
      ],
      it => it.branchMap[0].locations,
    ));
});

describe.concurrent.each([
  ["./src/a.cjs", `Module._resolveFilename = () => name; require("alias");`],
  ["a.cjs", `process.chdir("src"), Module._extensions[".js"](new Module(name), name);`],
  ["src//a.cjs", `await import(URL.createObjectURL(Bun.file(name)));`],
  // Windows takes out `link\..` before it looks for the link.
  [isWindows ? "link/../src/a.cjs" : "link/../a.cjs", `await import(URL.createObjectURL(Bun.file(name)));`],
])("a file that is loaded as %s", (name, load) => {
  test.each<[string, string[], number]>([
    [`coverageInclude = "src"`, ["src/a.cjs|0.00|100.00|100.00|100.00|1"], 0],
    [`coveragePathIgnorePatterns = "src/*"`, [], 0],
    [`coverageThreshold = { src = { functions = 1 } }`, ["src/a.cjs|0.00|100.00|100.00|100.00|1"], 1],
  ])("%s", async (option, rows, expectedExitCode) => {
    using dir = tempDir("cov-relative", {
      "bunfig.toml": bunfig(option),
      "src/a.cjs": "Object(() => {});",
      "src/folder": {},
      "a.test.js": `
        import { codeCoverageForFile } from "bun:jsc";
        import Module from "node:module";
        const name = "${name}";
        ${load}
        if (${rows.length}) codeCoverageForFile(name);`,
    });
    symlinkSync(path.join(String(dir), "src", "folder"), path.join(String(dir), "link"), "junction");
    const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
    expect(rowsOf(stderr).slice(1)).toEqual(rows);
    expect(exitCode).toBe(expectedExitCode);
  });
});

test.concurrent("a link stays in a name that has ..", async () => {
  using dir = tempDir("cov-relative", {
    "shared/a.js": "export const pick = v => (v ? 1 : 2);",
    "app/bunfig.toml": bunfig(),
    "app/folder": {},
    "app/a.test.js": `
      for (const [index, name] of ["link/a.js", "folder/../link/a.js"].entries())
        (await import(URL.createObjectURL(Bun.file(name)))).pick(index);`,
  });
  symlinkSync(path.join(String(dir), "shared"), path.join(String(dir), "app", "link"), "junction");
  const { stderr, exitCode } = await bun(path.join(String(dir), "app"), ["test", "--coverage"]);
  expect(rowsOf(stderr).slice(1)).toEqual(["link/a.js|100.00|100.00|100.00|100.00|"]);
  expect(exitCode).toBe(0);
});

test.concurrent("a name that is made up is listed and ignored in the form of a path", async () => {
  using dir = tempDir("cov-virtual", {
    "bunfig.toml": bunfig(`coveragePathIgnorePatterns = "https:/a/ignored.js"`),
    "a.test.ts": `
      for (const name of ["https://a/ignored.js", "https://a/listed.js", "made-up/../a.js"]) {
        Bun.plugin({ setup: build => void build.module(name, () => ({ contents: "Object();", loader: "js" })) });
        require(name);
      }`,
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
  expect(rowsOf(stderr).slice(1)).toEqual([
    "https:/a/listed.js|100.00|100.00|100.00|100.00|",
    "made-up/../a.js|100.00|100.00|100.00|100.00|",
  ]);
  expect(exitCode).toBe(0);
});

// Only on Windows does the working directory keep the link.
test.concurrent.each([
  ["link/app", "../shared"],
  ["link-to-app", isWindows ? "../real/shared" : "../shared"],
])("in the working directory %s", async (cwd, shared) => {
  using dir = tempDir("cov-linked-root", {
    "real/app/bunfig.toml": bunfig(
      `preload = "./setup.js"`,
      `coverageInclude = [".", "${shared}"]`,
      `coveragePathIgnorePatterns = "ignored.js"`,
      `coverageDir = "${shared}/coverage"`,
      `coverageReporter = ["text", "json"]`,
    ),
    "real/app/setup.js": "Object();",
    "real/app/built.js": "Object();",
    "real/app/ignored.js": "Object();",
    "real/app/loaded.js": "Object();",
    "real/app/unloaded.js": "Object();",
    "real/app/bundle.js": built("Object();"),
    "real/app/bundle.js.map": sourceMap(["../shared/built.js"], ["Object();"], ";AAAA"),
    "real/shared/built.js": "Object();",
    "real/shared/loaded.js": "Object();",
    "real/shared/relative.js": "Object();",
    "real/shared/unloaded.js": "Object();",
    "real/app/a.test.js": `
      import { realpathSync } from "node:fs";
      import { resolve } from "node:path";
      await Bun.build({ entrypoints: ["built.js"], outdir: "out", target: "bun", sourcemap: "linked" });
      Bun.plugin({ setup: build => void build.module(resolve("made-up.js"), () => ({ contents: "", loader: "js" })) });
      require(resolve("made-up.js"));
      await import(URL.createObjectURL(Bun.file("../shared/relative.js")));
      for (const name of ["out/built.js", "bundle.js", "ignored.js", "loaded.js", resolve("${shared}/loaded.js")])
        for (const file of [name, realpathSync(name)]) await import(URL.createObjectURL(Bun.file(file)));`,
  });
  symlinkSync(path.join(String(dir), "real"), path.join(String(dir), "link"), "junction");
  symlinkSync(path.join(String(dir), "real", "app"), path.join(String(dir), "link-to-app"), "junction");
  const { stderr, exitCode } = await bun(path.join(String(dir), cwd), ["test", "--coverage"]);
  expect(rowsOf(stderr).slice(1)).toEqual([
    "built.js|100.00|100.00|100.00|100.00|",
    "loaded.js|100.00|100.00|100.00|100.00|",
    "made-up.js|100.00|100.00|100.00|100.00|",
    "unloaded.js|100.00|0.00|0.00|100.00|1",
    `${shared}/built.js|100.00|100.00|100.00|100.00|`,
    `${shared}/loaded.js|100.00|100.00|100.00|100.00|`,
    `${shared}/relative.js|100.00|100.00|100.00|100.00|`,
    `${shared}/unloaded.js|100.00|0.00|0.00|100.00|1`,
  ]);
  const report = readFileSync(path.join(String(dir), "real", "shared", "coverage", "coverage-final.json"), "utf8");
  expect(Object.keys(JSON.parse(report))[0]).toBe(path.join(String(dir), isWindows ? cwd : "real/app", "built.js"));
  expect(exitCode).toBe(0);
});

test.concurrent.each<[string, string[], string[]]>([
  [bunfig(`preload = "./setup.ts"`), [], ["helper.ts"]],
  [bunfig(`preload = "./setup"`), ["--parallel=2"], ["helper.ts"]],
  [bunfig(), ["--preload=./setup.ts", "--coverage-include=."], ["helper.ts"]],
  [bunfig(), ["--preload=file://./setup.ts"], ["helper.ts"]],
  ["[test]\ncoverageSkipTestFiles = false", ["-r", "./setup.ts"], ["a.test.ts", "b.test.ts", "helper.ts", "setup.ts"]],
])("a preload is listed if test files are: %j %j", async (config, flags, listed) => {
  using dir = tempDir("cov-preload", {
    "bunfig.toml": config,
    "setup.ts": `import "./helper.ts";`,
    "helper.ts": "",
    "a.test.ts": "",
    "b.test.ts": "",
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage", ...flags]);
  expect(rowsOf(stderr).slice(1)).toEqual(listed.map(it => `${it}|100.00|100.00|100.00|100.00|`));
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/15538
test.concurrent.each(["--coverage", "--coverage-include=.", "--coverage-include=.."])(
  "%s in a project that is in node_modules",
  async flag => {
    using dir = tempDir("cov-in-node-modules", {
      "node_modules/app/bunfig.toml": bunfig(),
      "node_modules/app/package.json": `{ "name": "app", "sideEffects": false }`,
      "node_modules/app/lib.js": "export const unused = 1;",
      "node_modules/app/node_modules/nested/index.js": "",
      "node_modules/hoisted/index.js": "",
      "node_modules/app/a.test.js": `import "./lib.js"; import "nested"; import "hoisted";`,
    });
    const { stderr, exitCode } = await bun(path.join(String(dir), "node_modules", "app"), ["test", flag]);
    expect(rowsOf(stderr).slice(1)).toEqual(["lib.js|100.00|100.00|100.00|100.00|"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent.each([
  ["--coverage", "made-up.js|100.00|100.00|100.00|100.00|"],
  ["--coverage-include=.", "made-up.js|100.00|0.00|0.00|100.00|1"],
])("%s: a module that a plugin makes up is not the file of that name", async (flag, row) => {
  using dir = tempDir("cov-virtual", {
    "bunfig.toml": bunfig(),
    "made-up.js": "Object();",
    "a.test.ts": `
      Bun.plugin({ setup: build => void build.module("made-up.js", () => ({ contents: "Object();", loader: "js" })) });
      require("made-up.js");`,
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", flag]);
  expect(rowsOf(stderr).slice(1)).toEqual([row]);
  expect(exitCode).toBe(0);
});

// Windows doesn't allow `?` and `:` in a file name.
test.concurrent.skipIf(isWindows).each<[string, string[]]>([
  ["--coverage", ["lib.js?\0", "lib.js?\0bundle", "source.js", "made-up:\0", "made-up:\0bundle"]],
  ["--coverage-include=*.js", ["lib.js?\0", "lib.js?\0bundle", "source.js"]],
  ["--coverage-include=lib.js?", []],
])("%s: a name does not end at a null byte", async (flag, listed) => {
  const map = (source: string) => sourceMap([source], ["Object();"], ";AAAA");
  const url = `//# sourceMappingURL=data:application/json;base64,${btoa(map("source.js"))}`;
  const test = (code: string) => `
    const texts = ${JSON.stringify({ "": code, bundle: built(code), mapped: built("Object();") + url })};
    const load = ({ path }) => ({ contents: texts[path.split("\\0")[1]], loader: "js" });
    for (const namespace of ["file", "made-up"])
      Bun.plugin({ setup: build => void build.onLoad({ filter: /\\0/, namespace }, load) });
    for (const name of ["./lib.js?\\0", "made-up:\\0"]) await import(name), await import(name + "bundle");
    await import("./lib.js?\\0mapped");`;
  using dir = tempDir("cov-null-byte", {
    "bunfig.toml": bunfig(),
    "lib.js": "Object();",
    "source.js": "Object();",
    "lib.js?": map("lib.js"),
    "made-up:": map("lib.js"),
    "a.test.ts": test("Object();"),
    "b.test.ts": test("Array();"),
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--isolate", flag]);
  expect(rowsOf(stderr).slice(1)).toEqual(listed.map(it => `${it}|100.00|100.00|100.00|100.00|`));
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows).each(["Array();", "Object(); Object();"])(
  "a module with the name of a pipe is loaded again as %s",
  async again => {
    const test = (contents: string) => `
      const name = process.cwd() + "/pipe.js";
      Bun.plugin({ setup: build => void build.module(name, () => ({ contents: "${contents}", loader: "js" })) });
      require(name);`;
    using dir = tempDir("cov-pipe", {
      "bunfig.toml": bunfig(),
      "a.test.ts": test("Object();"),
      "b.test.ts": test(again),
    });
    mkfifo(path.join(String(dir), "pipe.js"));
    const { stderr, exitCode } = await bun(String(dir), ["test", "--isolate", "--coverage"]);
    expect(rowsOf(stderr).slice(1)).toEqual(["pipe.js|100.00|100.00|100.00|100.00|"]);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("an error in the value of a macro has its position", async () => {
  using dir = tempDir("cov-macro", {
    "macro.ts": `export function cyclic() { const a = {}; return (a.a = a); }`,
    "lib.ts": `import { cyclic } from "./macro.ts" with { type: "macro" };\nexport const a = cyclic();`,
    "a.test.ts": `import "./lib.ts";`,
  });
  const { stderr, exitCode } = await bun(String(dir), ["test", "--coverage"]);
  expect(stderr).toMatch(/error: Maximum call stack size exceeded\s+at .*lib\.ts:2:18/);
  expect(exitCode).toBe(1);
});

test.concurrent.each([[[]], [["--parallel=2"]]])("the flags override bunfig.toml: %j", async parallel => {
  using dir = tempDir("cov-flags", {
    "bunfig.toml": bunfig(`coverage = false`, `coverageReporter = "lcov"`, `coverageDir = "from-bunfig"`),
    "lib.ts": "",
    "a.test.ts": `import "./lib.ts";`,
    "b.test.ts": "",
  });
  const fromBunfig = await bun(String(dir), ["test", "--coverage", ...parallel]);
  expect(readFileSync(path.join(String(dir), "from-bunfig", "lcov.info"), "utf8")).toContain("SF:lib.ts\n");
  expect(fromBunfig.exitCode).toBe(0);

  const flags = ["--coverage-reporter=json-summary", "--coverage-dir=from-flag"];
  const fromFlags = await bun(String(dir), ["test", ...flags, ...parallel]);
  expect(readdirSync(path.join(String(dir), "from-flag"))).toEqual(["coverage-summary.json"]);
  expect(fromFlags.exitCode).toBe(0);
});

test.concurrent.each<[string, string[], string]>([
  [
    "",
    ["--coverage-reporter=html"],
    `invalid coverage reporter 'html'. Available options: 'text' (console output), 'lcov' (lcov.info), 'json' (coverage-final.json), 'json-summary' (coverage-summary.json)`,
  ],
  [`coverageReporter = ["text", "html"]`, [], `Invalid coverage reporter "html"`],
  [`coverageInclude = 1`, [], `coverageInclude must be a string or array of strings`],
  [`coverageInclude = [1]`, [], `coverageInclude must be a string or array of strings`],
  [`coverageThreshold = { branches = "1" }`, [], `expected number but received string`],
  [`coverageThreshold = { src = { branches = "1" } }`, [], `expected number but received string`],
  [`coverageThreshold = { perFile = 1 }`, [], `expected boolean but received number`],
  [`coverageDir = "a.test.ts\\u0000"`, ["--coverage-reporter=lcov"], `expected a string without null bytes`],
  [`coverageInclude = "a\\u0000"`, [], `expected a string without null bytes`],
  [`coverageInclude = ["a", "b\\u0000"]`, [], `expected a string without null bytes`],
  [`coverageThreshold = { "a\\u0000" = { lines = 1 } }`, [], `expected a string without null bytes`],
])("%s %j is an error", async (option, flags, message) => {
  using dir = tempDir("cov-invalid", { "bunfig.toml": bunfig(option), "a.test.ts": "" });
  const { stderr, exitCode } = await bun(String(dir), ["test", ...flags]);
  expect(stderr).toContain(`error: ${message}`);
  expect(exitCode).toBe(1);
});

test.concurrent("bun:jsc codeCoverageForFile() throws for what is not counted", async () => {
  using dir = tempDir("cov-for-file", {
    "lib.ts": `export const a = 1;`,
    "a.test.ts": `
      import { codeCoverageForFile } from "bun:jsc";
      import "./lib.ts";
      try {
        console.log(codeCoverageForFile(require.resolve("./lib.ts"), true));
      } catch (error) {
        console.log(error.message);
      }`,
    "ignores.toml": bunfig("coverageIgnoreSourcemaps = true"),
  });
  const [plain, covered, ignored] = await Promise.all(
    [[], ["--coverage"], ["--coverage", "--config=ignores.toml"]].map(flags => bun(String(dir), ["test", ...flags])),
  );
  expect(ignored.stdout).toContain("lib.ts | ");
  expect(plain.stdout).toEndWith("\nNo source for file\n");
  expect(covered.stdout).toEndWith(`\nTo ignore source maps, set "coverageIgnoreSourcemaps" in bunfig.toml\n`);
});
