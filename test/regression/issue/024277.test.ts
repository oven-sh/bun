import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/24277
// AsyncDisposableStack.use() should accept objects with only @@dispose (sync),
// falling back from @@asyncDispose per the TC39 spec.

test("AsyncDisposableStack.use() with sync @@dispose falls back correctly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      await using scope = new AsyncDisposableStack();

      scope.use({
        async [Symbol.asyncDispose]() {
          console.log("async dispose");
        },
      });

      scope.use({
        [Symbol.dispose]() {
          console.log("sync dispose");
        },
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // Resources are disposed in LIFO order (stack)
  expect(stdout).toBe("sync dispose\nasync dispose\n");
  expect(exitCode).toBe(0);
});

test("await using with sync @@dispose falls back correctly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function main() {
        const log = [];
        {
          await using a = {
            async [Symbol.asyncDispose]() {
              log.push("async");
            },
          };
          await using b = {
            [Symbol.dispose]() {
              log.push("sync");
            },
          };
        }
        console.log(log.join(","));
      }
      await main();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // LIFO order: b disposed first (sync), then a (async)
  expect(stdout).toBe("sync,async\n");
  expect(exitCode).toBe(0);
});

test("AsyncDisposableStack.use() throws when neither @@asyncDispose nor @@dispose is present", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      try {
        await using scope = new AsyncDisposableStack();
        scope.use({});
        console.log("ERROR: should have thrown");
      } catch (e) {
        console.log("caught: " + (e instanceof TypeError));
      }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("caught: true\n");
  expect(exitCode).toBe(0);
});

test("AsyncDisposableStack.use() with @@asyncDispose still works", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      await using scope = new AsyncDisposableStack();
      scope.use({
        async [Symbol.asyncDispose]() {
          console.log("async only");
        },
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("async only\n");
  expect(exitCode).toBe(0);
});
