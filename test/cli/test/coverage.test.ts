import { describe, test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";
import path from "path";
import { readFileSync } from "node:fs";

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

describe("coveragePathIgnorePatterns", () => {
  const demoFiles = {
    "demo1.ts": `
  // covered
  export function covered() {
    return 1;
  }
  `,
    "demo2.ts": `
  // tested but not covered
  export function uncovered() {
    return 2;
  }
  `,
    "demo.test.ts": `
  import { expect, test } from "bun:test";
  import { covered } from "./demo1";
  import { uncovered } from "./demo2";
  test("demo", () => {
    expect(covered()).toBe(1);
    expect(uncovered()).toBe(2);
  })
  `,
  };

  test("coverage path ignore patterns", () => {
    const dir = tempDirWithFiles("cov", {
      "bunfig.toml": `[test]
coverage = true
coveragePathIgnorePatterns = [ "**/demo2.ts" ]
coverageReporter = ["text", "lcov"]
`,
      ...demoFiles,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: {
        ...bunEnv,
      },
      stderr: "pipe",
      stdout: "inherit",
      stdin: "ignore",
    });

    const stderr = result.stderr.toString();

    expect(result.exitCode).toBe(0);
    expect(stderr).toContain("demo1.ts");
    expect(stderr).not.toContain("demo2.ts");
    expect(readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8")).toMatchSnapshot();
  });

  test("coverage path ignore everything", () => {
    const dir = tempDirWithFiles("cov", {
      "bunfig.toml": `[test]
coverage = true
coveragePathIgnorePatterns = "**"
coverageReporter = ["text", "lcov"]
`,
      ...demoFiles,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: {
        ...bunEnv,
      },
      stderr: "pipe",
      stdout: "inherit",
      stdin: "ignore",
    });

    const stderr = result.stderr.toString();

    expect(result.exitCode).toBe(0);
    expect(stderr).toMatch(/All files\s*|\s*0.00\s*|\s*0.00\s*|/g);
    expect(stderr).not.toContain("demo1.ts");
    expect(stderr).not.toContain("demo2.ts");
    expect(readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8")).toMatchSnapshot();
  });

  test("coverage path invalid config", () => {
    const dir = tempDirWithFiles("cov", {
      "bunfig.toml": `[test]
coverage = true
coveragePathIgnorePatterns = 123
coverageReporter = ["text", "lcov"]
`,
      ...demoFiles,
    });

    const result = Bun.spawnSync([bunExe(), "test"], {
      cwd: dir,
      env: {
        ...bunEnv,
      },
      stderr: "pipe",
      stdout: "inherit",
      stdin: "ignore",
    });

    const stderr = result.stderr.toString();

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("coveragePathIgnorePatterns");
  });
});
