import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("toArrayBuffer/toBuffer with small invalid pointer throws instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const r1 = Bun.FFI.toArrayBuffer(143);
      const r2 = Bun.FFI.toBuffer(143);
      const r3 = Bun.FFI.toArrayBuffer(1);
      console.log(r1 instanceof TypeError);
      console.log(r2 instanceof TypeError);
      console.log(r3 instanceof TypeError);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("true\ntrue\ntrue\n");
  expect(stderr).not.toContain("panic");
  expect(exitCode).toBe(0);
});
