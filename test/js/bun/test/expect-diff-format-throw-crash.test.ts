import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A failing matcher renders a diff of the received and expected values. If
// pretty-printing the received value throws, the error must not stay pending on
// the VM while the expected value is formatted. The matcher reports its own
// failure instead.
async function run(setup: string, assertion: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { expect } = Bun.jest();
      ${setup}
      try {
        ${assertion}
        console.log("no error");
      } catch (e) {
        console.log(String(e).split("\\n")[0]);
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const throwingToStringTag = `
  const fn = function named() {};
  Object.defineProperty(fn, Symbol.toStringTag, { get() { throw new Error("getter threw"); } });
`;

const throwingHasTrap = `
  const fn = function named() {};
  Object.setPrototypeOf(fn, new Proxy(Function.prototype, { has() { throw new Error("has trap threw"); } }));
`;

test.concurrent("failing matcher when Symbol.toStringTag getter on a function throws", async () => {
  const { stdout, stderr, exitCode } = await run(throwingToStringTag, `expect({ fn }).toMatchObject({ b: 16 });`);
  expect(stdout).toBe("Error: expect(received).toMatchObject(expected)\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.concurrent("failing matcher when a Proxy has trap in the prototype chain throws", async () => {
  const { stdout, stderr, exitCode } = await run(throwingHasTrap, `expect({ fn }).toMatchObject({ b: 16 });`);
  expect(stdout).toBe("Error: expect(received).toMatchObject(expected)\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// matcherHint returns the rendered hint to the custom matcher, so the error
// from pretty-printing is thrown to the caller instead of being dropped.
test.concurrent("matcherHint throws the formatting error instead of aborting", async () => {
  const { stdout, stderr, exitCode } = await run(
    throwingToStringTag +
      `
      expect.extend({
        toHint(received, expected) {
          return { pass: false, message: () => this.utils.matcherHint("toHint", received, expected) };
        },
      });
    `,
    `expect({ fn }).toHint({ b: 16 });`,
  );
  expect(stdout).toBe("Error: getter threw\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
