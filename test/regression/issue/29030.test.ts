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
    expect(() => assert.deepStrictEqual({}, Object.create(null))).toThrow(assert.AssertionError);
    expect(() => assert.deepStrictEqual(Object.create(null), {})).toThrow(assert.AssertionError);
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
    expect(() => assert.deepStrictEqual(new Foo(), new Bar())).toThrow(assert.AssertionError);
    expect(isDeepStrictEqual(new Foo(), new Bar())).toBe(false);
  });

  test("objects with non-null properties still compare by prototype", () => {
    const withProto = { a: 1, b: 2 };
    const noProto = Object.assign(Object.create(null), { a: 1, b: 2 });
    expect(() => assert.deepStrictEqual(withProto, noProto)).toThrow(assert.AssertionError);
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
    expect(() => assert.deepStrictEqual(new Sub(), new Base())).toThrow(assert.AssertionError);
    expect(isDeepStrictEqual(new Sub(), new Base())).toBe(false);
  });

  test("non-strict deepEqual still ignores prototype differences", () => {
    // The Node.js loose `assert.deepEqual` / `util.isDeepEqual` does NOT
    // check prototypes. Verify we didn't regress the loose path.
    expect(() => assert.deepEqual({}, Object.create(null))).not.toThrow();
    expect(() => assert.deepEqual(Object.create(null), {})).not.toThrow();
  });
});
