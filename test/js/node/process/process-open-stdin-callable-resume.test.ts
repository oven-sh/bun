import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { run } from "../../../aot/harness/run";

test("process.openStdin() calls a `resume` that is callable but no ordinary function", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    "-e",
    `
      process.stdin.resume = new Proxy(function () { console.log("resume called"); }, {});
      console.log(process.openStdin() === process.stdin);
      process.exit(0);
      `,
  ]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "resume called\ntrue\n", stderr: "", exitCode: 0 });
});
