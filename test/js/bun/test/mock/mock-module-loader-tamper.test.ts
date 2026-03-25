import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("mock.module does not crash when globalThis.Loader is overwritten with non-object", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      globalThis.Loader = 42;
      const v2 = Bun.jest(import.meta.path).mock;
      try { v2.module("test", () => ({ default: 1 })); } catch(e) {}
      Bun.gc(true);
      console.log("ok");
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("mock.module does not crash when globalThis.Loader is deleted", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      delete globalThis.Loader;
      const v2 = Bun.jest(import.meta.path).mock;
      try { v2.module("test", () => ({ default: 1 })); } catch(e) {}
      Bun.gc(true);
      console.log("ok");
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
