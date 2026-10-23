import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("process.openStdin() calls a `resume` that is callable but no ordinary function", async () => {
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.stdin.resume = new Proxy(function () { console.log("resume called"); }, {});
      console.log(process.openStdin() === process.stdin);
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "resume called\ntrue\n", stderr: "", exitCode: 0 });
});
