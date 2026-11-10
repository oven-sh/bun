import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("util.inspect() of a module namespace object does not call a replaced Function.prototype.bind", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const util = require("node:util");
      util.inspect({});
      import("node:os").then(namespace => {
        const original = Function.prototype.bind;
        let calls = 0;
        Function.prototype.bind = function (...given) { calls++; return original.apply(this, given); };
        const text = util.inspect(namespace, { depth: 0 });
        Function.prototype.bind = original;
        console.log(calls, text.includes("Module"));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "0 true\n", stderr: "", exitCode: 0 });
});
