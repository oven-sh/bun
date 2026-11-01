import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Inspecting a value can run user code (a custom inspect method) that throws.
// The matcher utils must surface that as a catchable JS exception. The
// unfixed build aborts the process instead, so the input runs in a child.
test("matcher utils propagate exceptions thrown while inspecting the value", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { expect } from "bun:test";
        const caught = {};
        expect.extend({
          _printThrowingValue(received) {
            for (const util of ["stringify", "printExpected", "printReceived"]) {
              try {
                this.utils[util](received);
                caught[util] = "did not throw";
              } catch (e) {
                caught[util] = e.message;
              }
            }
            return { pass: true, message: () => "" };
          },
        });
        expect({
          [Symbol.for("nodejs.util.inspect.custom")]() {
            throw new Error("inspect failed");
          },
        })._printThrowingValue();
        console.log(JSON.stringify(caught));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      stringify: "inspect failed",
      printExpected: "inspect failed",
      printReceived: "inspect failed",
    }),
    stderr: "",
    exitCode: 0,
  });
});
