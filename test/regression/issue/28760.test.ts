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
