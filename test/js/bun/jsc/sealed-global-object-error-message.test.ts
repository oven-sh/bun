import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("without --aot, the error for a new property on a sealed global object does not mention --aot", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Object.seal(globalThis);
       try {
         Object.defineProperty(globalThis, "neverDefined", { value: 1, configurable: true });
       } catch (error) {
         console.log(error.message);
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({
    stdout: "Attempting to define property on object that is not extensible.\n",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
