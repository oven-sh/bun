import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isWindows } from "harness";

const isFFIUnavailable = isWindows && isArm64;

describe.skipIf(isFFIUnavailable)("FFI pointer validation", () => {
  test("toArrayBuffer/toBuffer with small invalid pointer throws instead of crashing", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const r1 = Bun.FFI.toArrayBuffer(143);
        const r2 = Bun.FFI.toBuffer(143);
        const r3 = Bun.FFI.toArrayBuffer(1);
        const r4 = Bun.FFI.toBuffer(1);
        console.log(r1 instanceof TypeError);
        console.log(r2 instanceof TypeError);
        console.log(r3 instanceof TypeError);
        console.log(r4 instanceof TypeError);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("true\ntrue\ntrue\ntrue\n");
    expect(exitCode).toBe(0);
  });
});
