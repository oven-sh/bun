import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect().toBeEmptyObject() does not crash when called on non-empty objects", async () => {
  // Regression test: ownPropertyKeys on certain objects could leak exceptions
  // through RELEASE_AND_RETURN, causing a releaseAssertNoException crash.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const mod = Bun.jest(import.meta.path);
      const e = mod.expect(mod);
      try { e.toBeEmptyObject(); } catch (err) {}
      console.log("ok");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
