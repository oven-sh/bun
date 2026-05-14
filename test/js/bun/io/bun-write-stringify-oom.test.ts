import { expect, test } from "bun:test";
import { tmpdirSync } from "harness";
import { join } from "node:path";

// Bun.write(data) stringifies non-Blob/non-ArrayBufferLike values via
// JSValue::toWTFString. If that returns a null WTF::String (rope OOM,
// etc.), BunString__fromJS used to return Dead without guaranteeing an
// exception, tripping a debug assertion in bun.String.fromJS. The fix
// ensures an OOM error is thrown in that edge case; this test exercises
// the stringify path with values that force rope resolution and
// Symbol.toPrimitive errors so it stays covered.

test("Bun.write stringifies non-blob data without asserting", async () => {
  const dir = tmpdirSync();
  const out = join(dir, "out.txt");

  const values: unknown[] = [
    ArrayBuffer, // native constructor -> function source
    function f() {},
    { toString: () => "obj" },
    { [Symbol.toPrimitive]: () => "prim" },
  ];

  for (const v of values) {
    await Bun.write(out, v as any);
  }

  // Symbol can't be converted to a string; must throw a JS error, not crash.
  expect(() => Bun.write(out, Symbol("s") as any)).toThrow();
});

test("Bun.write with huge rope toString throws OOM cleanly", async () => {
  const dir = tmpdirSync();
  const out = join(dir, "out.txt");

  // Build a rope whose resolved length exceeds the String max so resolving
  // it inside toWTFString fails the allocation. The rope itself is cheap
  // (just fiber pointers); only resolution needs the full buffer.
  let s = "x";
  for (let i = 0; i < 30; i++) s = s + s; // length 2^30
  const huge = {
    toString() {
      return s + s + s + s; // 2^32 chars -> guaranteed OOM on resolve
    },
  };

  let threw = false;
  try {
    await Bun.write(out, huge as any);
  } catch (e) {
    threw = true;
    expect(e).toBeInstanceOf(Error);
  }
  expect(threw).toBe(true);
});
