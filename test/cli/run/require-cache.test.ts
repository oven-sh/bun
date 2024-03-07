import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";

// This also tests __dirname and __filename
test("require.cache", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-fixture.cjs")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim()).toEndWith("--pass--");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/5188
test("require.cache does not include unevaluated modules", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-bug-5188.js")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim()).toEndWith("--pass--");
  expect(exitCode).toBe(0);
});

describe("files transpiled and loaded don't leak the AST", () => {
  test("via require()", () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-bug-leak-fixture.js")],
      env: bunEnv,
      stderr: "inherit",
    });

    expect(stdout.toString().trim()).toEndWith("--pass--");
    expect(exitCode).toBe(0);
  }, 20000);

  test("via import()", () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "run", join(import.meta.dir, "esm-bug-leak-fixture.mjs")],
      env: bunEnv,
      stderr: "inherit",
    });

    expect(stdout.toString().trim()).toEndWith("--pass--");
    expect(exitCode).toBe(0);
  }, 20000);
});

// These tests are extra slow in debug builds
describe("files transpiled and loaded don't leak file paths", () => {
  test("via require()", () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--smol", "run", join(import.meta.dir, "cjs-fixture-leak-small.js")],
      env: bunEnv,
      stderr: "inherit",
    });

    expect(stdout.toString().trim()).toEndWith("--pass--");
    expect(exitCode).toBe(0);
  }, 30000);

  test(
    "via import()",
    () => {
      const { stdout, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), "--smol", "run", join(import.meta.dir, "esm-fixture-leak-small.mjs")],
        env: bunEnv,
        stderr: "inherit",
      });

      expect(stdout.toString().trim()).toEndWith("--pass--");
      expect(exitCode).toBe(0);
    },
    // TODO: Investigate why this is so slow on Windows
    isWindows ? 60000 : 30000,
  );
});
