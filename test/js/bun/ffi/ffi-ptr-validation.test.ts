import { toArrayBuffer, CString } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("toArrayBuffer with small invalid pointer does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { Bun.FFI.toArrayBuffer(1929); } catch(e) {} console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test("CString with small invalid pointer does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { Bun.FFI.CString(1929); } catch(e) {} console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
