import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("toArrayBuffer with small invalid pointer does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { Bun.FFI.toArrayBuffer(1929); } catch(e) {} console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test.concurrent("CString with small invalid pointer does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { Bun.FFI.CString(1929); } catch(e) {} console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test.concurrent("read.u8 with small invalid pointer throws TypeError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `let ok=false; try { Bun.FFI.read.u8(1929); } catch(e) { ok = e instanceof TypeError; } if (!ok) process.exit(1); console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
