// When nothing refs the event loop but the runtime itself keeps driving it
// (test runner awaiting a test, top-level await in the entrypoint), unref'd
// timers must still fire. On Windows they previously never fired in this
// state (uv_run skips timers when the loop has no ref'd handles), and on
// POSIX the loop busy-spun until the deadline.
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("unref'd setTimeout fires while the test runner keeps the process alive", async () => {
  const fired = await new Promise(resolve => {
    setTimeout(() => resolve(true), 20).unref();
  });
  expect(fired).toBe(true);
});

it("unref'd setInterval fires while the test runner keeps the process alive", async () => {
  const fired = await new Promise(resolve => {
    const t = setInterval(() => {
      clearInterval(t);
      resolve(true);
    }, 20);
    t.unref();
  });
  expect(fired).toBe(true);
});

it("unref'd setTimeout fires while top-level await keeps the process alive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const fired = await new Promise(resolve => {
        setTimeout(() => resolve(true), 20).unref();
      });
      console.log(fired ? "fired" : "did not fire");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "fired", exitCode: 0 });
});

it("waiting on an unref'd timer parks the event loop instead of spinning", async () => {
  // The child measures CPU consumed across the await only, so slow debug
  // startup doesn't count. Unfixed, the event loop busy-spins the whole
  // 2000ms wait (cpu time tracks wall time); parked, it stays near zero.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const cpu0 = process.cpuUsage();
      const fired = await new Promise(resolve => {
        setTimeout(() => resolve(true), 2000).unref();
      });
      const cpu = process.cpuUsage(cpu0);
      console.log(JSON.stringify({ fired, cpuMs: Math.round((cpu.user + cpu.system) / 1000) }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // `|| "null"` keeps JSON.parse from throwing on empty output so the
  // assertion below reports exitCode instead.
  const output = JSON.parse(stdout.trim() || "null");
  expect({ output, exitCode }).toEqual({
    output: { fired: true, cpuMs: expect.any(Number) },
    exitCode: 0,
  });
  expect(output.cpuMs).toBeLessThan(1000);
});
