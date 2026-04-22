import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("accessing Bun.$ after stack overflow from recursive constructor does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function F() {
  try { new this.constructor(); } catch {}
  Bun.$;
}
new F();
console.log("ok");
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
