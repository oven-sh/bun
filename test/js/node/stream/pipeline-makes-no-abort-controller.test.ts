import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("stream.pipeline() neither makes nor aborts an AbortController of the program's", async () => {
  await using child = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const Original = AbortController;
      let made = 0, aborted = 0;
      globalThis.AbortController = class extends Original {
        constructor() { super(); made++; }
        abort(reason) { aborted++; return super.abort(reason); }
      };
      const { PassThrough, pipeline, Readable } = require("node:stream");
      pipeline(Readable.from(["x"]), new PassThrough().resume(), error => {
        console.log(JSON.stringify({ error: error ?? null, made, aborted }));
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ error: null, made: 0, aborted: 0 }),
    stderr: "",
    exitCode: 0,
  });
});
