import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { run } from "../../../aot/harness/run";

test("require() of bun:test under a computed name does not call a replaced Bun.jest", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    "-e",
    `
      const name = ["bun", "test"].join(":");
      let calls = 0;
      Bun.jest = () => { calls++; return "mine"; };
      console.log(typeof require(name), calls);
      `,
  ]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "object 0\n", stderr: "", exitCode: 0 });
});
