// Uses node:test (not bun:test) so the exact same file runs under both
// `node --test` and `bun test` — proving structuredClone/v8 preserve an Error's
// `cause` identically in both runtimes. Byte-exact serialization is NOT a goal
// (Bun uses WebKit's SerializedScriptValue format, Node uses V8's serializer);
// what must match is the observable result of cloning/round-tripping.
//
// structured-clone.test.ts spawns `node --test` on this file so the Node.js
// side of the parity claim is enforced in CI, not just runnable by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import v8 from "node:v8";

const clones: Array<[string, (value: any) => any]> = [
  ["structuredClone", structuredClone],
  ["v8 round-trip", value => v8.deserialize(v8.serialize(value))],
];

for (const [name, clone] of clones) {
  test(`${name} preserves a string cause as a non-enumerable own data property`, () => {
    const e = clone(new TypeError("typed", { cause: "boom" }));
    assert.ok(e instanceof TypeError);
    assert.equal(e.message, "typed");
    assert.deepEqual(Object.getOwnPropertyDescriptor(e, "cause"), {
      value: "boom",
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  test(`${name} leaves an Error without a cause unchanged`, () => {
    const e = clone(new Error("nc"));
    assert.ok(!Object.hasOwn(e, "cause"));
    assert.equal(e.cause, undefined);
  });

  test(`${name} preserves a number cause`, () => {
    assert.equal(clone(new Error("x", { cause: 42 })).cause, 42);
  });

  test(`${name} preserves an explicit undefined cause as an own property`, () => {
    const e = clone(new Error("x", { cause: undefined }));
    assert.ok(Object.hasOwn(e, "cause"));
    assert.equal(e.cause, undefined);
  });

  test(`${name} preserves an object cause structurally`, () => {
    const e = clone(new Error("x", { cause: { code: 42, nested: { ok: true } } }));
    assert.deepEqual(e.cause, { code: 42, nested: { ok: true } });
  });

  test(`${name} preserves a nested Error cause as an Error of the right type`, () => {
    const e = clone(new Error("outer", { cause: new RangeError("inner") }));
    assert.ok(e.cause instanceof RangeError);
    assert.equal(e.cause.message, "inner");
    assert.ok(!Object.hasOwn(e.cause, "cause"));
  });

  test(`${name} preserves a chain of Error causes`, () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    const e = clone(new Error("c", { cause: b }));
    assert.equal(e.message, "c");
    assert.equal(e.cause.message, "b");
    assert.equal(e.cause.cause.message, "a");
    assert.ok(!Object.hasOwn(e.cause.cause, "cause"));
  });

  test(`${name} preserves a cyclic cause as the same reference, non-enumerable`, () => {
    const o = new Error("self");
    o.cause = o; // an enumerable own property on the input
    const e = clone(o);
    assert.equal(e.cause, e);
    assert.equal(Object.getOwnPropertyDescriptor(e, "cause")!.enumerable, false);
  });

  test(`${name} keeps identity when the same Error appears twice`, () => {
    const o = new Error("shared", { cause: "x" });
    const e = clone([o, o]);
    assert.equal(e[0], e[1]);
    assert.equal(e[0].cause, "x");
  });

  test(`${name} preserves cause and identity inside containers`, () => {
    const o = new Error("e", { cause: [1, 2, 3] });
    const e = clone({ arr: [o], map: new Map([["k", o]]) });
    assert.ok(e.arr[0] instanceof Error);
    assert.deepEqual(e.arr[0].cause, [1, 2, 3]);
    assert.equal(e.map.get("k"), e.arr[0]);
  });
}
