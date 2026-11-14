import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { run } from "../../../aot/harness/run";

test("without --aot, the error for a new property on a sealed global object does not mention --aot", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    "-e",
    `Object.seal(globalThis);
       try {
         Object.defineProperty(globalThis, "neverDefined", { value: 1, configurable: true });
       } catch (error) {
         console.log(error.message);
       }`,
  ]);
  expect({ stdout, stderr }).toEqual({
    stdout: "Attempting to define property on object that is not extensible.\n",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
