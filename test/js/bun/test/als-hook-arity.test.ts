import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import path from "node:path";

// Registering a zero-arg test() or hook inside an active AsyncLocalStorage
// context used to be treated as taking a done callback (the AsyncContextFrame
// wrapper has no `.length`), so the callback would wait for done() and time
// out. Run the fixture with a short per-test timeout so the unfixed build
// fails fast rather than sitting on the 5s default for each entry.
test("tests and hooks registered inside an AsyncLocalStorage context detect done-callback arity correctly", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=500", path.join(import.meta.dir, "als-hook-arity.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/js/bun/test/als-hook-arity.fixture.ts:
    (pass) registered inside an active ALS context > zero-arg test
    (pass) registered inside an active ALS context > one-arg test still receives done
    (pass) registered inside an active ALS context > nested describe > passes
    (pass) hooks and tests registered inside an ALS context use the callback's real arity

     4 pass
     0 fail
     4 expect() calls
    Ran 4 tests across 1 file."
  `);
  expect(stdout).not.toContain("timed out");
  expect(exitCode).toBe(0);
});
