// JSC parser: once the native stack check fires on a deeply nested object/array
// literal, save-point backtracking (assignment-expression -> destructuring
// pattern -> member expression) used to clear the error and retry at every
// nesting level, turning an O(depth) failure into an exponential reparse loop
// that hung with unbounded memory growth. Now the first overflow is sticky and
// eval() rejects with RangeError in constant time regardless of depth.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

for (const [name, open, close] of [
  ["object literal", "{a:", "}"],
  ["array literal", "[", "]"],
] as const) {
  test(`deeply nested ${name} passed to eval() throws RangeError instead of hanging`, async () => {
    // 50000 is far beyond the stack limit on every platform and build config;
    // before the fix this hung forever (killed by the spawn timeout below).
    const depth = 50000;
    const fixture = `
      const src = "const y = " + Buffer.alloc(${depth * open.length}, ${JSON.stringify(open)}).toString()
        + "1" + Buffer.alloc(${depth * close.length}, ${JSON.stringify(close)}).toString() + ";";
      try {
        eval(src);
        console.log("no-throw");
      } catch (e) {
        console.log(e.constructor.name + ": " + e.message);
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "RangeError: Maximum call stack size exceeded.",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 30_000);
}
