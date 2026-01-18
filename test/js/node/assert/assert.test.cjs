const assert = require("assert");
const assertStrict = require("assert/strict");

test("assert from require as a function does not throw", () => assert(true));
test("assert from require as a function does throw", () => {
  try {
    assert(false);
    expect(false).toBe(true);
  } catch (e) {}
});

// Regression test for #24045
test("assert.deepStrictEqual() should compare Number wrapper object values - issue #24045", () => {
  // Different values should throw
  expect(() => {
    assertStrict.deepStrictEqual(new Number(1), new Number(2));
  }).toThrow("Expected values to be strictly deep-equal");

  // Same values should not throw
  expect(() => {
    assertStrict.deepStrictEqual(new Number(1), new Number(1));
  }).not.toThrow();

  // Edge cases
  // 0 and -0 should be different in strict mode
  expect(() => {
    assertStrict.deepStrictEqual(new Number(0), new Number(-0));
  }).toThrow("Expected values to be strictly deep-equal");

  // NaN should equal NaN
  expect(() => {
    assertStrict.deepStrictEqual(new Number(NaN), new Number(NaN));
  }).not.toThrow();

  expect(() => {
    assertStrict.deepStrictEqual(new Number(Infinity), new Number(-Infinity));
  }).toThrow("Expected values to be strictly deep-equal");
});

// Regression test for #24045
test("assert.deepStrictEqual() should compare Boolean wrapper object values - issue #24045", () => {
  // Different values should throw
  expect(() => {
    assertStrict.deepStrictEqual(new Boolean(true), new Boolean(false));
  }).toThrow("Expected values to be strictly deep-equal");

  // Same values should not throw
  expect(() => {
    assertStrict.deepStrictEqual(new Boolean(true), new Boolean(true));
  }).not.toThrow();

  expect(() => {
    assertStrict.deepStrictEqual(new Boolean(false), new Boolean(false));
  }).not.toThrow();
});

// Regression test for #24045
test("assert.deepStrictEqual() should not compare Number wrapper with primitive", () => {
  // Wrapper objects should not equal primitives in strict mode
  expect(() => {
    assertStrict.deepStrictEqual(new Number(1), 1);
  }).toThrow("Expected values to be strictly deep-equal");

  expect(() => {
    assertStrict.deepStrictEqual(1, new Number(1));
  }).toThrow("Expected values to be strictly deep-equal");
});

// Regression test for #24045
test("assert.deepStrictEqual() should not compare Boolean wrapper with primitive", () => {
  // Wrapper objects should not equal primitives in strict mode
  expect(() => {
    assertStrict.deepStrictEqual(new Boolean(true), true);
  }).toThrow("Expected values to be strictly deep-equal");

  expect(() => {
    assertStrict.deepStrictEqual(false, new Boolean(false));
  }).toThrow("Expected values to be strictly deep-equal");
});

// Regression test for #24045
test("assert.deepStrictEqual() should not compare Number and Boolean wrappers", () => {
  // Different wrapper types should not be equal even with truthy/falsy values
  expect(() => {
    assertStrict.deepStrictEqual(new Number(1), new Boolean(true));
  }).toThrow("Expected values to be strictly deep-equal");

  expect(() => {
    assertStrict.deepStrictEqual(new Number(0), new Boolean(false));
  }).toThrow("Expected values to be strictly deep-equal");
});

// Regression test for #24045
test("assert.deepStrictEqual() should check own properties on wrapper objects", () => {
  // Same internal value but different own properties should not be equal
  const num1 = new Number(42);
  const num2 = new Number(42);
  num1.customProp = "hello";

  expect(() => {
    assertStrict.deepStrictEqual(num1, num2);
  }).toThrow("Expected values to be strictly deep-equal");

  // Same internal value and same own properties should be equal
  num2.customProp = "hello";
  expect(() => {
    assertStrict.deepStrictEqual(num1, num2);
  }).not.toThrow();

  // Different own property values should not be equal
  const bool1 = new Boolean(true);
  const bool2 = new Boolean(true);
  bool1.foo = 1;
  bool2.foo = 2;

  expect(() => {
    assertStrict.deepStrictEqual(bool1, bool2);
  }).toThrow("Expected values to be strictly deep-equal");
});
