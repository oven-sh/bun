import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("toContainValue does not crash after caught stack overflow", async () => {
  // Without a ThrowScope in JSC__JSValue__values, toContainValue calls
  // objectValues on the Bun object after a caught stack overflow, which throws
  // but the exception goes untracked, corrupting VM state and causing a crash.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `function F() { try { new this.constructor(); } catch(e) {} Bun.jest().expect(Bun).toContainValue(1546); } new F();`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should exit with a JS error (1), not a crash signal (132/134/139)
  expect(exitCode).toBe(1);
});
