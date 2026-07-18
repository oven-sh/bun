import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { itBundled } from "./expectBundled";

// expectBundled throws on any BundlerTestInput field it doesn't destructure. itBundled
// swallows that throw in its registration-time dry-run, so an undestructured option
// silently drops the test instead of failing it. This file guards harness-only options.
describe("bundler", () => {
  itBundled("options/AcceptsTimeoutScale", {
    files: {
      "/entry.js": `console.log("timeoutScale ok");`,
    },
    run: { stdout: "timeoutScale ok" },
    timeoutScale: 1,
  });
});

// On Windows the `new Error().stack!.includes("test/bundler/")` check at the top of
// expectBundled sees backslashes and throws, which itBundled swallows, so every itBundled
// test is silently dropped there regardless of timeoutScale. Tracked separately.
test.skipIf(isWindows)("itBundled registers tests that set timeoutScale (not silently skipped)", async () => {
  // Without the fix this reports "matched 0 tests": timeoutScale fell into unknownProps,
  // the dry-run threw, and itBundled swallowed it. Same path dropped edgecase/AwsCdkLib
  // and plugin/ResolveManySegfault on main.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.path, "-t", "AcceptsTimeoutScale"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;
  expect(output).toContain("options/AcceptsTimeoutScale");
  expect(output).not.toContain("matched 0 tests");
  expect(exitCode).toBe(0);
});
