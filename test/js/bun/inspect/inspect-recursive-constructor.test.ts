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

  expect(stderr).toContain("RangeError");
  // Exits with 1 from uncaught RangeError, not a crash signal
  expect(exitCode).toBe(1);
});
