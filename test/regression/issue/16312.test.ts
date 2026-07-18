import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/16312
// `expect.extend(* as matchers)` must iterate namespace-import own properties.
// Run in a subprocess: jest-dom ships a `toBeEmpty` matcher that would
// override Bun's built-in on the shared Expect prototype and break every
// subsequent `.toBeEmpty()` call in the same `bun test` process.
test("expect extended", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", join(import.meta.dir, "16312.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});
