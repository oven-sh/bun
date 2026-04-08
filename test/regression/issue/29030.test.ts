// https://github.com/oven-sh/bun/issues/29030
//
// `assert.deepStrictEqual` must compare prototypes with `===` in strict mode,
// so `{}` (prototype === Object.prototype) and `Object.create(null)`
// (prototype === null) are NOT deep-strict-equal.
import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { isDeepStrictEqual } from "node:util";

describe("issue #29030 - deepStrictEqual prototype check", () => {
  test("{} vs Object.create(null) is not strict-deep-equal", () => {
    expect(() => assert.deepStrictEqual({}, Object.create(null))).toThrow();
    expect(() => assert.deepStrictEqual(Object.create(null), {})).toThrow();
    expect(isDeepStrictEqual({}, Object.create(null))).toBe(false);
    expect(isDeepStrictEqual(Object.create(null), {})).toBe(false);
  });

  test("Object.create(null) vs Object.create(null) is still strict-deep-equal", () => {
    expect(() => assert.deepStrictEqual(Object.create(null), Object.create(null))).not.toThrow();
    expect(isDeepStrictEqual(Object.create(null), Object.create(null))).toBe(true);
  });

  test("{} vs {} is still strict-deep-equal", () => {
    expect(() => assert.deepStrictEqual({}, {})).not.toThrow();
    expect(isDeepStrictEqual({}, {})).toBe(true);
  });

  test("two instances of the same class are strict-deep-equal", () => {
    class Foo {
      constructor(public x: number) {}
    }
    expect(() => assert.deepStrictEqual(new Foo(1), new Foo(1))).not.toThrow();
    expect(isDeepStrictEqual(new Foo(1), new Foo(1))).toBe(true);
  });

  test("instances of different classes are not strict-deep-equal", () => {
    class Foo {}
    class Bar {}
    expect(() => assert.deepStrictEqual(new Foo(), new Bar())).toThrow();
    expect(isDeepStrictEqual(new Foo(), new Bar())).toBe(false);
  });

  test("objects with non-null properties still compare by prototype", () => {
    const withProto = { a: 1, b: 2 };
    const noProto = Object.assign(Object.create(null), { a: 1, b: 2 });
    expect(() => assert.deepStrictEqual(withProto, noProto)).toThrow();
    expect(isDeepStrictEqual(withProto, noProto)).toBe(false);
  });

  test("two null-proto objects with same own properties are strict-deep-equal", () => {
    const a = Object.assign(Object.create(null), { a: 1, b: 2 });
    const b = Object.assign(Object.create(null), { a: 1, b: 2 });
    expect(() => assert.deepStrictEqual(a, b)).not.toThrow();
    expect(isDeepStrictEqual(a, b)).toBe(true);
  });

  test("a subclass instance and a base-class instance are not strict-deep-equal", () => {
    class Base {}
    class Sub extends Base {}
    expect(() => assert.deepStrictEqual(new Sub(), new Base())).toThrow();
    expect(isDeepStrictEqual(new Sub(), new Base())).toBe(false);
  });

  test("non-strict deepEqual still ignores prototype differences", () => {
    // The Node.js loose `assert.deepEqual` does NOT check prototypes.
    // Verify we didn't regress the loose path.
    expect(() => assert.deepEqual({}, Object.create(null))).not.toThrow();
    expect(() => assert.deepEqual(Object.create(null), {})).not.toThrow();
  });

  test("array subclass vs plain array is not strict-deep-equal", () => {
    class Sub extends Array {}
    expect(() => assert.deepStrictEqual(new Sub(), [])).toThrow();
    expect(() => assert.deepStrictEqual(Sub.from([1, 2]), [1, 2])).toThrow();
    expect(isDeepStrictEqual(new Sub(), [])).toBe(false);
    expect(isDeepStrictEqual(Sub.from([1, 2]), [1, 2])).toBe(false);
  });

  test("same-instance array subclass comparisons are still strict-deep-equal", () => {
    class Sub extends Array {}
    expect(() => assert.deepStrictEqual(Sub.from([1, 2]), Sub.from([1, 2]))).not.toThrow();
    expect(isDeepStrictEqual(Sub.from([1, 2]), Sub.from([1, 2]))).toBe(true);
  });

  test("Map subclass vs plain Map is not strict-deep-equal", () => {
    class MyMap extends Map {}
    expect(() => assert.deepStrictEqual(new MyMap(), new Map())).toThrow();
    expect(isDeepStrictEqual(new MyMap(), new Map())).toBe(false);
  });

  test("Set subclass vs plain Set is not strict-deep-equal", () => {
    class MySet extends Set {}
    expect(() => assert.deepStrictEqual(new MySet([1]), new Set([1]))).toThrow();
    expect(isDeepStrictEqual(new MySet([1]), new Set([1]))).toBe(false);
  });

  test("Error subclass vs plain Error is not strict-deep-equal", () => {
    class MyError extends Error {}
    expect(() => assert.deepStrictEqual(new MyError("x"), new Error("x"))).toThrow();
    expect(isDeepStrictEqual(new MyError("x"), new Error("x"))).toBe(false);
  });

  test("same-prototype Map/Set/Error pairs are still strict-deep-equal", () => {
    expect(() => assert.deepStrictEqual(new Map([[1, 2]]), new Map([[1, 2]]))).not.toThrow();
    expect(() => assert.deepStrictEqual(new Set([1, 2]), new Set([1, 2]))).not.toThrow();
    expect(() => assert.deepStrictEqual(new Error("x"), new Error("x"))).not.toThrow();
  });
});
