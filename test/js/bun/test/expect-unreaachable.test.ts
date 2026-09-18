import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect.unreachable()", () => {
  expect(expect.unreachable).toBeTypeOf("function");
  expect(() => expect.unreachable("message here")).toThrow("message here");
  const error = new Error("message here");
  expect(() => expect.unreachable(error)).toThrow(error);
  expect(() => expect.unreachable()).toThrow("reached unreachable code");
});

// Spawned: an empty message used to trip a debug assertion in JSC::createError and abort the process.
test("expect.unreachable('') throws an UnreachableError with an empty message", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try {
        Bun.jest(import.meta.path).expect.unreachable("");
      } catch (e) {
        console.log(JSON.stringify({ name: e.name, message: e.message, isError: e instanceof Error }));
      }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe('{"name":"UnreachableError","message":"","isError":true}\n');
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
