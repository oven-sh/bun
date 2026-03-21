import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.inspect(Bun) does not crash when called from recursive constructor", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function F() {
  if (!new.target) throw 'must be called with new';
  const v = this.constructor;
  try { new v(-9007199254740990); } catch (e) {}
  Bun.inspect(Bun);
}
new F();
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Should not crash - a RangeError from stack overflow is acceptable
  expect(exitCode).not.toBe(null);
  // Should not be a signal-based termination (crash)
  expect(exitCode).not.toBe(6); // SIGABRT
  expect(exitCode).not.toBe(11); // SIGSEGV
});
