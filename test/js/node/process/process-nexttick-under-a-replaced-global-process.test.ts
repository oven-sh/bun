// process.nextTick() asks the process object that it belongs to whether the process is exiting, as node does: not what a program has stored in globalThis.process.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("the first tick is queued under a replaced globalThis.process", async () => {
  const program = `
    const real = process, tick = process.nextTick, said = [];
    let asked = 0;
    globalThis.process = { get _exiting() { asked++; return true; } };
    tick(() => said.push("the tick ran"));
    globalThis.process = real;
    setTimeout(() => console.log(asked, said.join()), 10);
  `;
  await using child = Bun.spawn({ cmd: [bunExe(), "-e", program], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0 the tick ran\n", stderr: "", exitCode: 0 });
});
