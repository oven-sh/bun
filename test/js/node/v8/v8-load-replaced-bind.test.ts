import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function printedBy(program: string) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode };
}

test("loading node:v8 does not call a replaced Function.prototype.bind", async () => {
  const { stdout, exitCode } = await printedBy(`
    const original = Function.prototype.bind;
    let calls = 0;
    Function.prototype.bind = function (...args) {
      calls++;
      return original.apply(this, args);
    };
    require("node:v8");
    Function.prototype.bind = original;
    console.log(calls);`);
  expect(stdout).toBe("0\n");
  expect(exitCode).toBe(0);
});
