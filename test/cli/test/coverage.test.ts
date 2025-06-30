import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
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
  expect(readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8")).toMatchSnapshot();
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

test("--coverage-reporter automatically enables coverage", () => {
  const dir = tempDirWithFiles("cov", {
    "math.ts": `
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function uncoveredFunction(): number {
  return 42;
}
`,
    "math.test.ts": `
import { test, expect } from "bun:test";
import { add, multiply } from "./math";

test("math > add", () => {
  expect(add(2, 3)).toBe(5);
});

test("math > multiply", () => {
  expect(multiply(2, 3)).toBe(6);
});
`,
  });
  
  // Run with only --coverage-reporter (no --coverage flag)
  const result = Bun.spawnSync([bunExe(), "test", "--coverage-reporter", "text"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  
  // Verify coverage output is generated
  expect(stderr).toContain("All files");
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("% Lines");
  expect(stderr).toContain("Uncovered Line #s");
  expect(stderr).toContain("math.ts");
  
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});
