import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("spyOn works on static hash table function properties", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spyOn, jest } = Bun.jest(import.meta.path);
      const spy = spyOn(Bun, "gc");
      Bun.gc(true);
      if (spy.mock.calls.length !== 1) {
        throw new Error("Expected 1 call, got " + spy.mock.calls.length);
      }
      spy.mockRestore();
      Bun.gc(true);
      console.log("OK");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});

test.concurrent("spyOn preserves correct attributes after mockRestore", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spyOn, jest } = Bun.jest(import.meta.path);
      const spy = spyOn(Bun, "peek");
      spy.mockRestore();
      // After restore, the property should still work
      const p = Promise.resolve(42);
      const val = Bun.peek(p);
      if (val !== 42) {
        throw new Error("Expected 42, got " + val);
      }
      console.log("OK");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
});
