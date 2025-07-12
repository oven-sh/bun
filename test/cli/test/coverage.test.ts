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

test("coverage includes node_modules when enabled", () => {
  const dir = tempDirWithFiles("cov", {
    "node_modules/pi/index.js": `
    export const pi = 3.14;
    export const tau = 6.28;
    `,
    "demo.test.ts": `
    import { pi } from 'pi';
    console.log(pi);
    `,
    // Add a bunfig.toml to enable node_modules coverage
    "bunfig.toml": `\
[test]
coverage = true
coverageIncludeNodeModules = true
`,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  // Should include both the test file and node_modules/pi/index.js in the report
  const stderr = result.stderr.toString();
  expect(stderr).toContain("demo.test.ts");
  expect(stderr).toContain(path.join("node_modules", "pi", "index.js"));
  expect(result.exitCode).toBe(0);
  expect(result.signalCode).toBeUndefined();
});
