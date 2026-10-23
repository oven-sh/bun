import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("require() of bun:test under a computed name does not call a replaced Bun.jest", async () => {
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const name = ["bun", "test"].join(":");
      let calls = 0;
      Bun.jest = () => { calls++; return "mine"; };
      console.log(typeof require(name), calls);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "object 0\n", stderr: "", exitCode: 0 });
});
