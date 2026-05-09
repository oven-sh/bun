import { expect, test } from "bun:test";

// Throwing a value whose Symbol.toPrimitive returns a non-primitive previously
// caused the Fuzzilli REPRL loop to exit (the catch block's template literal
// re-threw), tripping a flaky use-after-poison in the error printer. User code
// should see a normal TypeError and the process should stay alive.

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

test("catch block that coerces a thrown value with bad Symbol.toPrimitive does not crash", () => {
  function F() {}
  F[Symbol.toPrimitive] = () => F;

  // Mirror the REPRL loop's shape: throw the value, catch it, attempt to
  // stringify it, and guard that stringification.
  let printed: string | undefined;
  try {
    throw F;
  } catch (_e) {
    try {
      printed = `uncaught:${_e as any}`;
    } catch {
      printed = "uncaught:<unprintable>";
    }
  }
  expect(printed).toBe("uncaught:<unprintable>");
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
