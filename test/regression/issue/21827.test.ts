import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://linear.app/oven/issue/ENG-21827
// Crash when deleting globalThis.Loader and then accessing module loader functionality

test("delete globalThis.Loader and then require a module", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      delete globalThis.Loader;
      // This should still work even after deleting Loader
      require("path");
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("delete globalThis.Loader and then import a module dynamically", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      delete globalThis.Loader;
      // Dynamic import should still work
      import("path").then(() => {
        console.log("ok");
      }).catch(e => {
        console.error(e);
        process.exit(1);
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("delete globalThis.Loader and gc should not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      delete globalThis.Loader;
      Bun.gc(true);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("delete globalThis.Loader and clearImmediate should not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      delete globalThis.Loader;
      clearImmediate(undefined);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
