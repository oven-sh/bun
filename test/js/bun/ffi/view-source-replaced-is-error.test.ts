import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function printedBy(program: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode };
}

test("viewSource throws its error though Error.isError is replaced", async () => {
  const { stdout, exitCode } = await printedBy(`
    const { viewSource } = require("bun:ffi");
    Error.isError = () => false;
    try {
      const result = viewSource({ made_up: { args: ["no such type"], returns: "void" } });
      console.log(result instanceof Error ? "returned the error" : "returned " + typeof result);
    } catch (error) {
      console.log("threw", error instanceof Error);
    }`);
  expect(stdout).toBe("threw true\n");
  expect(exitCode).toBe(0);
});
