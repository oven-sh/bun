import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI } from "harness";
import { itBundled } from "./expectBundled";

// itBundled registrations belong in files under test/bundler/, and the ones under test here must not
// land in this file's own run, so this file doubles as its own fixture: spawned with
// EXPECT_BUNDLED_TEST_CASE set it registers that case and nothing else, and the tests below spawn it
// that way and assert on what the child printed.
const CASE = "EXPECT_BUNDLED_TEST_CASE";
const files = { "/entry.js": /* js */ `console.log("hi");` };
// Each child loads expectBundled.ts, which alone takes a few seconds in a debug build. In CI the
// runner's --timeout applies, as it does to the itBundled tests themselves.
const childTimeout = isCI ? undefined : 30_000;

switch (process.env[CASE]) {
  case "duplicate ids":
    describe("copy+pasted in one describe block", () => {
      itBundled("harness/CopyPasted", { files });
      itBundled("harness/CopyPasted", { files });
    });
    for (const backend of ["api", "cli"] as const) {
      describe(`registered once per ${backend}`, () => {
        itBundled("harness/NotParameterized", { files, backend });
      });
    }
    describe("registered through a helper", () => {
      const add = (n: number) => itBundled(`harness/Case${n}`, { files });
      add(1);
      add(2);
      add(2);
    });
    describe("itBundled.skip then itBundled", () => {
      itBundled.skip("harness/Skipped", { files });
      itBundled("harness/Skipped", { files });
    });
    describe("itBundled then itBundled.only", () => {
      itBundled("harness/Focused", { files });
      itBundled.only("harness/Focused", { files });
    });
    describe("on both sides of an await that does not need the event loop", async () => {
      itBundled("harness/AroundAwait", { files });
      await Promise.resolve();
      itBundled("harness/AroundAwait", { files });
    });
    break;

  case "unique ids":
    describe("bundler", () => {
      itBundled("harness/Unique", { files });
      itBundled.skip("harness/UniqueSkipped", { files });
      console.log("collected the ids");
    });
    break;

  default:
    describe("itBundled ids must be unique within a test file", () => {
      test.concurrent(
        "every id registered twice fails the file, however it was registered",
        async () => {
          // The errors are raised while the file is collected; nothing needs to run.
          const { output, exitCode } = await runBunTest([import.meta.path, "-t", "^$"], { [CASE]: "duplicate ids" });
          const reported = [...output.matchAll(/^error: itBundled\("(.*?)", \.\.\.\) was registered twice\./gm)].map(
            m => m[1],
          );
          expect(reported).toEqual([
            "harness/CopyPasted",
            "harness/NotParameterized",
            "harness/Case2",
            "harness/Skipped",
            "harness/Focused",
            "harness/AroundAwait",
          ]);
          expect(exitCode).toBe(1);
        },
        childTimeout,
      );

      test.concurrent(
        "--rerun-each registers the same ids again without tripping the check",
        async () => {
          const { output, exitCode } = await runBunTest([import.meta.path, "--rerun-each", "3"], {
            [CASE]: "unique ids",
          });
          expect(output).not.toContain("was registered twice");
          expect(output.match(/collected the ids/g)).toHaveLength(3);
          expect(exitCode).toBe(0);
        },
        childTimeout,
      );
    });
}

async function runBunTest(args: string[], env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: import.meta.dir,
    env: {
      ...bunEnv,
      // A developer's shell may carry these; they would change what the child registers.
      BUN_BUNDLER_TEST_FILTER: undefined,
      BUN_BUNDLER_TEST_USE_ESBUILD: undefined,
      BUN_BUNDLER_TEST_DEBUG: undefined,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { output: stdout + stderr, exitCode };
}
