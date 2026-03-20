import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("worker double terminate does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require("worker_threads");
      const w = new Worker("setTimeout(() => {}, 100000)", { eval: true });
      w.on("online", async () => {
        // Call terminate, then call it again after it resolves.
        // The second call should be a safe no-op, not a crash.
        const code = await w.terminate();
        // threadId is -1 after termination in Node compat — second
        // terminate() returns Promise.resolve() without hanging.
        w.terminate();
        console.log("ok", code);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});

test("worker concurrent terminate does not crash", async () => {
  // Fire two terminate() calls without awaiting the first — the racy case.
  // Don't await the promises (the second one hangs due to a pre-existing
  // JS-side bug), but verify the process exits cleanly via the exit event.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require("worker_threads");
      const w = new Worker("setTimeout(() => {}, 100000)", { eval: true });
      w.on("online", () => {
        w.terminate();
        w.terminate();
        w.on("exit", (code) => console.log("ok", code));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});

test("worker terminate then GC does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require("worker_threads");
      const w = new Worker("process.exit(1)", { eval: true });
      await new Promise(r => w.on("exit", r));
      Bun.gc(true);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});

test("worker natural exit then GC does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require("worker_threads");
      const w = new Worker("postMessage('hello')", { eval: true });
      await new Promise(r => w.on("exit", r));
      Bun.gc(true);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});

test("worker immediate terminate does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require("worker_threads");
      const w = new Worker("setTimeout(() => {}, 100000)", { eval: true });
      const code = await w.terminate();
      console.log("ok", code);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
