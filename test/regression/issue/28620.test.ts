import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, normalizeBunSnapshot } from "harness";

test("coverage table shown when only test files exist", () => {
  const dir = tempDirWithFiles("cov-28620", {
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

  // The coverage table should be present even when all files are test files
  expect(stderr).toContain("All files");
  expect(stderr).toContain("% Funcs");
  expect(stderr).toContain("% Lines");
  expect(result.exitCode).toBe(0);
});

test("coverage table shown with node:test and only test files", () => {
  const dir = tempDirWithFiles("cov-28620-node", {
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
  expect(result.exitCode).toBe(0);
});
