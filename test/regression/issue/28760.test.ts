import { expect, test } from "bun:test";
import assert from "node:assert";

test("assert.deepEqual throws for unequal Sets with duplicate-by-value objects", () => {
  expect(() => {
    assert.deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]));
  }).toThrow();
});

test("assert.deepStrictEqual throws for unequal Sets with duplicate-by-value objects", () => {
  expect(() => {
    assert.deepStrictEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]));
  }).toThrow();
});

test("assert.deepStrictEqual does not throw for equal Sets with objects", () => {
  expect(() => {
    assert.deepStrictEqual(new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 1 }, { a: 2 }]));
  }).not.toThrow();
});

test("assert.deepStrictEqual does not throw for equal Sets with duplicate-by-value objects", () => {
  expect(() => {
    assert.deepStrictEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 1 }]));
  }).not.toThrow();
});

test("assert.deepEqual throws for unequal Sets with nested objects", () => {
  expect(() => {
    assert.deepEqual(new Set([{ a: { b: 1 } }, { a: { b: 1 } }]), new Set([{ a: { b: 1 } }, { a: { b: 2 } }]));
  }).toThrow();
});

test("assert.deepStrictEqual throws for unequal Maps with duplicate-by-value keys", () => {
  expect(() => {
    assert.deepStrictEqual(
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 1 }, "y"],
      ]),
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 2 }, "y"],
      ]),
    );
  }).toThrow();
});

test("Bun.deepEquals returns false for unequal Sets with duplicate-by-value objects", () => {
  expect(Bun.deepEquals(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]))).toBe(false);
});

test("Bun.deepEquals returns true for equal Sets with duplicate-by-value objects", () => {
  expect(Bun.deepEquals(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 1 }]))).toBe(true);
});

test("expect().toEqual fails for unequal Sets with duplicate-by-value objects", () => {
  expect(new Set([{ a: 1 }, { a: 1 }])).not.toEqual(new Set([{ a: 1 }, { a: 2 }]));
});

test("Set with shared reference and deep-equal duplicate is not equal", () => {
  // Fast-path match for `shared` must not let fallback reuse same rhs slot
  const shared = { a: 1 };
  expect(Bun.deepEquals(new Set([shared, { a: 1 }]), new Set([shared, { a: 2 }]))).toBe(false);
});

test("Map with duplicate-by-value keys and different values in opposite order", () => {
  // Must check both key AND value before consuming an entry
  expect(
    Bun.deepEquals(
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 1 }, "y"],
      ]),
      new Map([
        [{ a: 1 }, "y"],
        [{ a: 1 }, "x"],
      ]),
    ),
  ).toBe(true);
});

test("Map with duplicate-by-value keys rejects when values differ", () => {
  expect(
    Bun.deepEquals(
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 1 }, "y"],
      ]),
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 1 }, "z"],
      ]),
    ),
  ).toBe(false);
});

// Asymmetric matchers (expect.anything, etc.) make the match relation non-transitive,
// so bijection-via-greedy matching misses valid pairings that exist. For expect().toEqual,
// we use Jest-compatible two-way subset semantics.
test("expect().toEqual with expect.anything mixed with concrete values in Set", () => {
  // Valid 1:1 pairing: {a:1}↔{a:1}, {a:2}↔anything()
  expect(new Set([{ a: 1 }, { a: 2 }])).toEqual(new Set([expect.anything(), { a: 1 }]));
});

test("expect().toEqual with expect.anything in Set - reverse order", () => {
  expect(new Set([expect.anything(), { a: 1 }])).toEqual(new Set([{ a: 1 }, { a: 2 }]));
});

test("expect().toEqual with expect.anything in Map", () => {
  // Valid 1:1 pairing: ({a:1},"x")↔({a:1},"x"), ({a:2},"y")↔(anything(),"y")
  expect(
    new Map<object, string>([
      [{ a: 1 }, "x"],
      [{ a: 2 }, "y"],
    ]),
  ).toEqual(
    new Map<object, string>([
      [expect.anything(), "y"],
      [{ a: 1 }, "x"],
    ]),
  );
});

test("expect().toEqual with self-referential Sets does not stack overflow", () => {
  // Both passes of the two-way subset check must preserve cycle detection
  // (consistent argument order to Bun__deepEquals).
  const a = new Set<unknown>();
  a.add(89);
  a.add("hello");
  a.add({ a: 1 });
  a.add([1, 2, 3]);
  a.add(a);
  const b = new Set<unknown>();
  b.add(89);
  b.add("hello");
  b.add(b);
  b.add({ a: 1 });
  b.add([1, 2, 3]);
  expect(a).toEqual(b);
  expect(b).toEqual(a);
});

test("expect().toEqual with self-referential Maps does not stack overflow", () => {
  // The object key is deep-equal but not reference-equal, so the hash-lookup fast
  // path misses and the comparison actually reaches the two-way subset slow path.
  const a = new Map<unknown, unknown>();
  a.set("self", a);
  a.set({ k: 1 }, 0);
  const b = new Map<unknown, unknown>();
  b.set({ k: 1 }, 0);
  b.set("self", b);
  expect(a).toEqual(b);
  expect(b).toEqual(a);
});

test("Bun.deepEquals with self-referential Maps and object keys does not stack overflow", () => {
  const a = new Map<unknown, unknown>();
  a.set("self", a);
  a.set({ k: 1 }, 0);
  const b = new Map<unknown, unknown>();
  b.set({ k: 1 }, 0);
  b.set("self", b);
  expect(Bun.deepEquals(a, b)).toBe(true);
  expect(Bun.deepEquals(b, a)).toBe(true);
  expect(Bun.deepEquals(a, b, true)).toBe(true);
});

// Depth-2 cycles: a Set/Map that contains ANOTHER self-referential Set/Map.
// The cycle closes through a nested pair, so element comparison must record
// nested pairs on the cycle stack (addToStack=true), matching Node.
test("Bun.deepEquals with nested self-referential Sets does not stack overflow", () => {
  const inner1 = new Set<unknown>();
  inner1.add(inner1);
  const inner2 = new Set<unknown>();
  inner2.add(inner2);
  expect(Bun.deepEquals(new Set([inner1]), new Set([inner2]))).toBe(true);
  expect(Bun.deepEquals(new Set([inner1]), new Set([inner2]), true)).toBe(true);
});

test("Bun.deepEquals with nested self-referential Maps (object keys) does not stack overflow", () => {
  const inner1 = new Map<unknown, unknown>();
  inner1.set("x", inner1);
  const inner2 = new Map<unknown, unknown>();
  inner2.set("x", inner2);
  expect(
    Bun.deepEquals(new Map<unknown, unknown>([[{ k: 1 }, inner1]]), new Map<unknown, unknown>([[{ k: 1 }, inner2]])),
  ).toBe(true);
});

test("Bun.deepEquals with nested self-referential Maps (string keys, fast path) does not stack overflow", () => {
  // String keys hash-match, so this exercises the fast-path value comparison.
  const inner1 = new Map<unknown, unknown>();
  inner1.set("x", inner1);
  const inner2 = new Map<unknown, unknown>();
  inner2.set("x", inner2);
  expect(Bun.deepEquals(new Map([["y", inner1]]), new Map([["y", inner2]]))).toBe(true);
});

test("expect().toEqual with nested self-referential Sets does not stack overflow", () => {
  const inner1 = new Set<unknown>();
  inner1.add(inner1);
  const inner2 = new Set<unknown>();
  inner2.add(inner2);
  expect(new Set([inner1])).toEqual(new Set([inner2]));
});

test("Bun.deepEquals rejects nested self-referential Sets with differing siblings", () => {
  // Cycle handling must not mask a real inequality elsewhere in the structure.
  const inner1 = new Set<unknown>();
  inner1.add(inner1);
  const inner2 = new Set<unknown>();
  inner2.add(inner2);
  expect(Bun.deepEquals(new Set([inner1, { a: 1 }]), new Set([inner2, { a: 2 }]))).toBe(false);
});
