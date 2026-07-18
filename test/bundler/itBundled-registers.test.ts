import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { itBundled } from "./expectBundled";

// Smoke test that itBundled actually registers tests on the current platform.
//
// Regression: expectBundled() checks that the caller lives under test/bundler/ by
// inspecting `new Error().stack`. On Windows the stack uses backslashes, so a
// forward-slash-only `.includes("test/bundler/")` never matched, the check threw,
// `itBundled`'s registration-time try/catch swallowed the throw, and every single
// itBundled test was silently never registered (0 tests, 0 failures, exit 0).

describe("bundler", () => {
  itBundled("harness/itBundledRegisters", {
    files: { "/entry.js": `console.log("registered")` },
    run: { stdout: "registered" },
  });
});

test("itBundled actually registers tests on this platform", async () => {
  // Spawn a fresh `bun test` against this file filtered to the itBundled case above.
  // Before the fix this reported "Ran 0 tests" on Windows; after, it reports 1 pass.
  const env = { ...bunEnv };
  // Don't let ambient bundler-harness dev knobs cause the child to skip registration.
  delete env.BUN_BUNDLER_TEST_FILTER;
  delete env.BUN_BUNDLER_TEST_USE_ESBUILD;
  delete env.BUN_BUNDLER_TEST_DEBUG;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.path, "-t", "harness/itBundledRegisters"],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  expect(output).not.toMatch(/matched 0 tests|Ran 0 tests/);
  expect(output).toMatch(/\b1 pass\b/);
  expect(output).toContain("harness/itBundledRegisters");
  expect(exitCode).toBe(0);
});
