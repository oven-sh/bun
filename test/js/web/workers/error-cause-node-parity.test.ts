// Uses node:test (not bun:test) so the exact same file runs under both
// `node --test` and `bun test` — proving structuredClone/v8 preserve an Error's
// `cause` identically in both runtimes. Byte-exact serialization is NOT a goal
// (Bun uses WebKit's SerializedScriptValue format, Node uses V8's serializer);
// what must match is the observable result of cloning/round-tripping.
import { test } from "node:test";
import assert from "node:assert/strict";
import v8 from "node:v8";

test("structuredClone preserves a string cause", () => {
  const e = structuredClone(new Error("x", { cause: "boom" }));
  assert.ok(Object.hasOwn(e, "cause"));
  assert.equal(e.cause, "boom");
});

test("structuredClone preserves an object cause structurally", () => {
  const e = structuredClone(new Error("x", { cause: { code: 42 } }));
  assert.deepEqual(e.cause, { code: 42 });
});

test("structuredClone preserves a nested Error cause", () => {
  const e = structuredClone(new Error("a", { cause: new Error("b") }));
  assert.ok(e.cause instanceof Error);
  assert.equal(e.cause.message, "b");
});

test("structuredClone preserves a cyclic cause as the same reference", () => {
  const o = new Error("c");
  o.cause = o;
  const e = structuredClone(o);
  assert.equal(e.cause, e);
});

test("structuredClone leaves an Error without a cause unchanged", () => {
  const e = structuredClone(new Error("nc"));
  assert.ok(!Object.hasOwn(e, "cause"));
});

test("v8 serialize/deserialize round-trips the cause", () => {
  const e = v8.deserialize(v8.serialize(new Error("a", { cause: new Error("b") })));
  assert.ok(e.cause instanceof Error);
  assert.equal(e.cause.message, "b");
});
