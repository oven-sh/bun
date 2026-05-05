import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When process.nextTick is accessed for the first time while the stack is
// already exhausted, the lazy initializer fails. Previously this cached the
// raw JSC::Exception cell as the value of process.nextTick, which then
// tripped a debug assertion in JSCell::toStringSlowCase (and threw a bogus
// "Cannot convert a symbol to a string" in release) when JS later tried to
// call it and build the "is not a function" error message.
test("process.nextTick first accessed at max stack depth does not crash", async () => {
  const src = `
    let done = false;
    function F0() {
      if (done) return;
      try { F0(); } catch (e) {
        done = true;
        try { process.nextTick; } catch (_) {}
      }
    }
    F0();
    const nt = process.nextTick;
    if (nt !== undefined && typeof nt !== "function")
      throw new Error("process.nextTick leaked as a non-function value (typeof " + typeof nt + ")");
    try { process.nextTick(); } catch (e) {
      if (!(e instanceof Error)) throw new Error("unexpected throw " + e);
    }
    console.log("ok", typeof nt);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toMatch(/^ok (undefined|function)$/);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
