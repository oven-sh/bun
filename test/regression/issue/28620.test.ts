import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("coverage table shown when only test files exist", () => {
  const dir = tempDirWithFiles("cov-28620", {
    "bunfig.toml": `
[test]
coverageSkipTestFiles = true
`,
    "i.test.mjs": `
import { test } from 'bun:test';

test('foo', () => {
  if (false) {
    throw new Error('Failed');
  } else {
    // pass
  }
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: bunEnv,
    stdio: [null, null, "pipe"],
  });

  const stderr = result.stderr.toString("utf-8");

  // The coverage table should be present even when all files are skipped
  expect(stderr).toContain("All files");
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("% Lines");
  // Built-in modules should not appear in the coverage table
  expect(stderr).not.toContain("internal:");
  expect(result.exitCode).toBe(0);
});

test("coverage table shown with node:test and only test files", () => {
  const dir = tempDirWithFiles("cov-28620-node", {
    "bunfig.toml": `
[test]
coverageSkipTestFiles = true
`,
    "i.test.mjs": `
import { test } from 'node:test';

test('foo', () => {
  if (false) {
    throw new Error('Failed');
  } else {
    // pass
  }
});
`,
  });

  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: bunEnv,
    stdio: [null, null, "pipe"],
  });

  const stderr = result.stderr.toString("utf-8");

  // The coverage table should be present even when using node:test
  expect(stderr).toContain("All files");
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("% Lines");
  // Built-in modules should not appear in the coverage table
  expect(stderr).not.toContain("internal:");
  expect(result.exitCode).toBe(0);
});
