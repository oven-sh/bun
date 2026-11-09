import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function printedBy(program: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode };
}

test("the first process warning does not call a replaced path.basename", async () => {
  const { stdout, exitCode } = await printedBy(`
    const path = require("node:path");
    const original = path.basename;
    let calls = 0;
    path.basename = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    process.emitWarning("made up");
    setImmediate(() => console.log(calls));`);
  expect(stdout).toBe("0\n");
  expect(exitCode).toBe(0);
});
