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

// Rendering a failure diff inspects both values. When inspecting the received
// value throws, the exception must not stay pending while the expected value
// is inspected. The unfixed build aborts on that pending exception, so the
// input runs in a child. The matcher reports its own failure, like the other
// matchers do when their message cannot be rendered.
test("failure diff does not crash when inspecting the received value throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { expect } from "bun:test";
        const received = new Proxy([1], {
          get(target, key, receiver) {
            if (key === "0") throw new Error("inspect failed");
            return Reflect.get(target, key, receiver);
          },
        });
        const caught = {};
        for (const matcher of ["toEqual", "toStrictEqual"]) {
          try {
            expect(received)[matcher]({});
            caught[matcher] = "did not throw";
          } catch (e) {
            caught[matcher] = e.message.split("\\n")[0];
          }
        }
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
      toEqual: "expect(received).toEqual(expected)",
      toStrictEqual: "expect(received).toStrictEqual(expected)",
    }),
    stderr: "",
    exitCode: 0,
  });
});

test("matcherHint propagates exceptions thrown while inspecting the value", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { expect } from "bun:test";
        const received = new Proxy([1], {
          get(target, key, receiver) {
            if (key === "0") throw new Error("inspect failed");
            return Reflect.get(target, key, receiver);
          },
        });
        let caught;
        expect.extend({
          _hint(received, expected) {
            try {
              this.utils.matcherHint("_hint", received, expected);
              caught = "did not throw";
            } catch (e) {
              caught = e.message;
            }
            return { pass: true, message: () => "" };
          },
        });
        expect(received)._hint({});
        console.log(JSON.stringify(caught));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify("inspect failed"),
    stderr: "",
    exitCode: 0,
  });
});
