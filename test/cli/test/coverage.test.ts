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

test("coveragePathIgnorePatterns - single pattern string", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
includeMe();
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
ignoreMe();
`,
    "test.test.ts": `
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

console.log(includeMe());
console.log(ignoreMe());
`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  expect(stderr).toContain("include-me.ts");
  expect(stderr).not.toContain("ignore-me.ts");
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - array of patterns", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["utils/**", "*.config.ts"]
`,
    "src/main.ts": `
export function main() {
  return "main";
}
main();
`,
    "utils/helper.ts": `
export function helper() {
  return "helper";
}
helper();
`,
    "build.config.ts": `
export const config = { build: true };
`,
    "test.test.ts": `
import { main } from "./src/main";
import { helper } from "./utils/helper";
import { config } from "./build.config";

console.log(main());
console.log(helper());
console.log(config);
`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  expect(stderr).toContain("src/main.ts");
  expect(stderr).not.toContain("utils/helper.ts");
  expect(stderr).not.toContain("build.config.ts");
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - glob patterns", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["**/*.spec.ts", "test-utils/**"]
`,
    "src/feature.ts": `
export function feature() {
  return "feature";
}
feature();
`,
    "src/feature.spec.ts": `
export function featureSpec() {
  return "spec";
}
featureSpec();
`,
    "test-utils/index.ts": `
export function testUtils() {
  return "utils";
}
testUtils();
`,
    "main.test.ts": `
import { feature } from "./src/feature";
import { featureSpec } from "./src/feature.spec";
import { testUtils } from "./test-utils";

console.log(feature());
console.log(featureSpec());
console.log(testUtils());
`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  expect(stderr).toContain("src/feature.ts");
  // Check that feature.spec.ts is not in the coverage table (after the header)
  const lines = stderr.split('\n');
  const tableStartIndex = lines.findIndex(line => line.includes('% Funcs'));
  const tableLines = lines.slice(tableStartIndex);
  const tableContent = tableLines.join('\n');
  expect(tableContent).not.toContain("feature.spec.ts");
  expect(tableContent).not.toContain("test-utils");
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - lcov reporter", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "ignore-me.ts"
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
includeMe();
`,
    "ignore-me.ts": `
export function ignoreMe() {
  return "ignored";
}
ignoreMe();
`,
    "test.test.ts": `
import { includeMe } from "./include-me";
import { ignoreMe } from "./ignore-me";

console.log(includeMe());
console.log(ignoreMe());
`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage", "--coverage-reporter", "lcov"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const lcovContent = readFileSync(path.join(dir, "coverage", "lcov.info"), "utf-8");
  expect(lcovContent).toContain("include-me.ts");
  expect(lcovContent).not.toContain("ignore-me.ts");
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - invalid config type", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = 123
`,
    "test.test.ts": `console.log("test");`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  expect(stderr).toContain("coveragePathIgnorePatterns must be a string or array of strings");
  expect(result.exitCode).toBe(1);
});

test("coveragePathIgnorePatterns - invalid array item", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = ["valid-pattern", 123]
`,
    "test.test.ts": `console.log("test");`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  expect(stderr).toContain("coveragePathIgnorePatterns array must contain only strings");
  expect(result.exitCode).toBe(1);
});

test("coveragePathIgnorePatterns - empty array", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = []
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
includeMe();
`,
    "test.test.ts": `
import { includeMe } from "./include-me";
console.log(includeMe());
`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  expect(stderr).toContain("include-me.ts");
  expect(result.exitCode).toBe(0);
});

test("coveragePathIgnorePatterns - ignore all files", () => {
  const dir = tempDirWithFiles("cov", {
    "bunfig.toml": `
[test]
coveragePathIgnorePatterns = "**"
`,
    "include-me.ts": `
export function includeMe() {
  return "included";
}
includeMe();
`,
    "test.test.ts": `
import { includeMe } from "./include-me";
console.log(includeMe());
`,
  });
  
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
    stdio: [null, null, "pipe"],
  });
  
  const stderr = result.stderr.toString("utf-8");
  expect(stderr).not.toContain("include-me.ts");
  expect(result.exitCode).toBe(0);
});
