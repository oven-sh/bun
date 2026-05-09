import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// Fuzzilli found a flaky use-after-poison that only triggers when the REPRL
// loop's catch block re-throws: the template literal `uncaught:${_e}` calls
// ToPrimitive on the thrown value, and if that returns a non-primitive a
// TypeError escapes the while(true) loop and takes the process down through
// the uncaught-exception path.
//
// This test drives the real src/js/eval/fuzzilli-reprl.ts source with an
// in-process mock of the REPRL file descriptors (see the fixture) and asserts
// the loop survives two exec cycles of a payload that throws such a value.

test("fuzzilli REPRL catch block does not let string coercion escape the loop", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl-catch.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim().split("\n").at(-1)).toBe("STATUS_WRITES=2");
  expect(exitCode).toBe(0);
});

test("template literal with object whose Symbol.toPrimitive returns a non-primitive throws TypeError", () => {
  function F() {}
  F[Symbol.toPrimitive] = () => F;

  let caught: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    `uncaught:${F as any}`;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(TypeError);
});

test("growable SharedArrayBuffer + Cookie.from with bad Symbol.toPrimitive does not crash", () => {
  new Uint16Array(new SharedArrayBuffer(198, { maxByteLength: 268435439 }));

  function F() {}
  F[Symbol.toPrimitive] = () => F;

  expect(() => Bun.Cookie.from(new ArrayBuffer(0) as any, F as any)).toThrow(TypeError);

  let thrown: unknown;
  try {
    throw F;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBe(F);
});
