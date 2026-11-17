import { expect, test } from "bun:test";
import { bunExe } from "harness";
import { run } from "../../../aot/harness/run";

test("stream.pipeline() neither makes nor aborts an AbortController of the program's", async () => {
  const { stdout, stderr, exitCode } = await run([
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
  ]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ error: null, made: 0, aborted: 0 }),
    stderr: "",
    exitCode: 0,
  });
});
