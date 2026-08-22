import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isDebug, isWindows } from "harness";
import { itBundled } from "./expectBundled";

// The itBundled registrations under test must not land in this file's own run, so the file doubles as
// its own fixture: spawned with EXPECT_BUNDLED_TEST_CASE set it registers that case and nothing else,
// and the tests below spawn it that way and assert on what the child printed.
const CASE = "EXPECT_BUNDLED_TEST_CASE";
const files = { "/entry.js": /* js */ `console.log("hi");` };
// Each child loads expectBundled.ts and maybe bundles one file, which takes a while in a debug build.
// In CI the runner's --timeout applies, as it does to the itBundled tests themselves.
const childTimeout = isCI ? undefined : isDebug ? Infinity : 30_000;

switch (process.env[CASE]) {
  case "unknown options":
    describe("an option BundlerTestInput does not declare", () => {
      itBundled("harness/Typo", {
        files,
        // @ts-expect-error the typo is the point
        bundeling: false,
      });
    });
    describe("next to an option the harness skips the test for", () => {
      itBundled("harness/TypoAndUnimplemented", {
        files,
        mangleProps: /_$/,
        // @ts-expect-error esbuild's name for `target`
        platform: "node",
      });
    });
    describe("on a todo test", () => {
      itBundled("harness/TypoOnTodo", {
        todo: true,
        files,
        // @ts-expect-error esbuild's name for `bundling`
        mode: "passthrough",
      });
    });
    break;

  case "skipped options":
    describe("bundler", () => {
      itBundled("harness/Registers", { files });
      // Implemented for the esbuild backend only.
      itBundled("harness/EsbuildOnlyOption", { files, legalComments: "none" });
      // Declared in BundlerTestInput, passed to neither backend.
      itBundled("harness/UnimplementedOption", { files, mangleProps: /_$/ });
      // Combination bun build does not support yet.
      itBundled("harness/NoBundleTwoEntryPoints", {
        files: { "/a.js": ``, "/b.js": `` },
        entryPoints: ["/a.js", "/b.js"],
        bundling: false,
      });
    });
    break;

  default:
    describe.concurrent("itBundled registration", () => {
      test(
        "a test passing an option the harness does not know fails the file instead of disappearing",
        async () => {
          const { output, exitCode } = await runBunTest({ [CASE]: "unknown options" });
          expect(output.match(/^error: expectBundled\(.*$/gm)).toEqual([
            'error: expectBundled("harness/Typo", ...) received unknown options: bundeling',
            'error: expectBundled("harness/TypoAndUnimplemented", ...) received unknown options: platform',
            'error: expectBundled("harness/TypoOnTodo", ...) received unknown options: mode',
          ]);
          expect(exitCode).toBe(1);
        },
        childTimeout,
      );

      // itBundled registers nothing on Windows for now (see the isWindows return in it), so there is
      // nothing to tell apart there.
      test.skipIf(isWindows)(
        "tests the current backend or the harness cannot run register nothing, the rest still register",
        async () => {
          const { output, exitCode } = await runBunTest({ [CASE]: "skipped options" });
          expect(registeredIds(output)).toEqual(["harness/Registers"]);
          expect(output).toContain("1 pass");
          expect(exitCode).toBe(0);
        },
        childTimeout,
      );
    });
}

/** The ids the child reported a result for, in any state (pass, fail, skip, todo). */
function registeredIds(output: string) {
  return [...output.matchAll(/^\((?:pass|fail|skip|todo)\) .*?(harness\/\w+)/gm)].map(m => m[1]);
}

async function runBunTest(env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.path],
    cwd: import.meta.dir,
    env: {
      ...bunEnv,
      // A developer's shell may carry these; they would change what the child registers.
      BUN_BUNDLER_TEST_FILTER: undefined,
      BUN_BUNDLER_TEST_USE_ESBUILD: undefined,
      BUN_BUNDLER_TEST_DEBUG: undefined,
      BUN_BUNDLER_TEST_HIDE_SKIP: undefined,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { output: stdout + stderr, exitCode };
}
