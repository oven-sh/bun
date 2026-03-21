import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

test("closeCallback with non-pointer argument throws instead of crashing", async () => {
  // closeCallback is deleted from Bun.FFI during bun:ffi module init,
  // but is accessible on the raw native FFI object before that happens.
  // We test via -e to access it before module init captures and deletes it.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      try { Bun.FFI.closeCallback("hello") } catch(e) { console.log(e.message) }
      try { Bun.FFI.closeCallback({}) } catch(e) { console.log(e.message) }
      try { Bun.FFI.closeCallback(null) } catch(e) { console.log(e.message) }
      try { Bun.FFI.closeCallback(0) } catch(e) { console.log(e.message) }
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe(
    "Expected a pointer\nExpected a pointer\nExpected a pointer\nExpected a non-null pointer\n",
  );
  expect(exitCode).toBe(0);
});
