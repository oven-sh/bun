import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/34398
// A GC between an async throw and the first .stack access used to cache the
// stack string from the GC finalizer without the error's name and message.
describe("error.stack after GC keeps name and message", () => {
  const cases = [
    {
      label: "async-thrown Error, GC before first .stack access",
      script: `
        async function boom() { throw new Error("the message"); }
        try { await boom(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "the message", stackHead: "Error: the message" },
    },
    {
      label: "async-thrown TypeError, name comes from the prototype",
      script: `
        async function boom() { throw new TypeError("boom"); }
        try { await boom(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "boom", stackHead: "TypeError: boom" },
    },
    {
      label: "async-thrown subclass with an own name property",
      script: `
        class MyError extends Error { name = "MyError"; }
        async function boom() { throw new MyError("custom"); }
        try { await boom(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "custom", stackHead: "MyError: custom" },
    },
    {
      label: "sync-thrown Error stays correct",
      script: `
        function boomSync() { throw new Error("sync message"); }
        try { boomSync(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "sync message", stackHead: "Error: sync message" },
    },
    {
      label: ".stack primed before GC stays correct",
      script: `
        async function boom() { throw new Error("primed message"); }
        try { await boom(); } catch (e) {
          const before = e.stack.split("\\n")[0];
          Bun.gc(true);
          console.log(JSON.stringify({ before, after: e.stack.split("\\n")[0] }));
        }`,
      expected: { before: "Error: primed message", after: "Error: primed message" },
    },
  ];

  test.concurrent.each(cases)("$label", async ({ script, expected }) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      throw new Error(`exited with ${exitCode}: ${stderr}`);
    }
    expect(JSON.parse(stdout)).toEqual(expected);
  });
});
