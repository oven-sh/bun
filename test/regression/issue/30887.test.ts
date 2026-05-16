import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Under `--parallel` / `--isolate`, `bun test` reads transpiled preloads from
// the isolation source provider cache. That path dropped the `has_tla` flag
// on the cached module record, so JSC treated TLA preloads as having none
// and let their evaluation promise resolve before the top-level-await
// actually completed. The preload's side effects (like `Bun.env.X = ...`)
// then happened *after* the test file started running.
//
// These tests assert that the preload's top-level await is awaited to
// completion before the test file runs, across all three modes.

async function runTest(cwd: string, extraArgs: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extraArgs],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

test.concurrent.each([
  ["sequential (default)", []],
  ["--isolate", ["--isolate"]],
  ["--parallel", ["--parallel"]],
])("async preload is awaited before tests run (%s)", async (_name, flags) => {
  using dir = tempDir("bun-test-30887-", {
    "preload.ts": `
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      Bun.env.MY_ENV = "MUST_NOT_BE_UNDEFINED";
    `,
    "my.test.ts": `
      import { test, expect } from "bun:test";
      test("MY_ENV must not be undefined", () => {
        expect(Bun.env.MY_ENV).toBe("MUST_NOT_BE_UNDEFINED");
      });
    `,
    "bunfig.toml": `
[test]
preload = ["./preload.ts"]
    `,
  });

  const { stdout, stderr, exitCode } = await runTest(String(dir), flags);

  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});
