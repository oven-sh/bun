import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A failing matcher renders a diff of the received and expected values. If
// pretty-printing the received value throws, the error must not stay pending on
// the VM while the expected value is formatted. The matcher reports its own
// failure instead.
async function run(setup: string) {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { expect } = Bun.jest();
      ${setup}
      try {
        expect({ fn }).toMatchObject({ b: 16 });
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

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

test.concurrent("failing matcher when Symbol.toStringTag getter on a function throws", async () => {
  const { stdout, exitCode } = await run(`
    const fn = function named() {};
    Object.defineProperty(fn, Symbol.toStringTag, { get() { throw new Error("getter threw"); } });
  `);
  expect(stdout).toBe("Error: expect(received).toMatchObject(expected)\n");
  expect(exitCode).toBe(0);
});

test.concurrent("failing matcher when a Proxy has trap in the prototype chain throws", async () => {
  const { stdout, exitCode } = await run(`
    const fn = function named() {};
    Object.setPrototypeOf(fn, new Proxy(Function.prototype, { has() { throw new Error("has trap threw"); } }));
  `);
  expect(stdout).toBe("Error: expect(received).toMatchObject(expected)\n");
  expect(exitCode).toBe(0);
});
