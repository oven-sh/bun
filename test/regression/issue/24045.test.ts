import assert from "assert/strict";
import { expect, test } from "bun:test";

test("assert.deepStrictEqual() should compare Number wrapper object values - issue #24045", () => {
  // Different values should throw
  expect(() => {
    assert.deepStrictEqual(new Number(1), new Number(2));
  }).toThrow("Expected values to be strictly deep-equal");

  // Same values should not throw
  expect(() => {
    assert.deepStrictEqual(new Number(1), new Number(1));
  }).not.toThrow();

  // Edge cases
  // 0 and -0 should be different in strict mode
  expect(() => {
    assert.deepStrictEqual(new Number(0), new Number(-0));
  }).toThrow("Expected values to be strictly deep-equal");

  // NaN should equal NaN
  expect(() => {
    assert.deepStrictEqual(new Number(NaN), new Number(NaN));
  }).not.toThrow();

  expect(() => {
    assert.deepStrictEqual(new Number(Infinity), new Number(-Infinity));
  }).toThrow("Expected values to be strictly deep-equal");
});

test("assert.deepStrictEqual() should compare Boolean wrapper object values - issue #24045", () => {
  // Different values should throw
  expect(() => {
    assert.deepStrictEqual(new Boolean(true), new Boolean(false));
  }).toThrow("Expected values to be strictly deep-equal");

  // Same values should not throw
  expect(() => {
    assert.deepStrictEqual(new Boolean(true), new Boolean(true));
  }).not.toThrow();

  expect(() => {
    assert.deepStrictEqual(new Boolean(false), new Boolean(false));
  }).not.toThrow();
});

test("assert.deepStrictEqual() should not compare Number wrapper with primitive", () => {
  // Wrapper objects should not equal primitives in strict mode
  expect(() => {
    assert.deepStrictEqual(new Number(1), 1);
  }).toThrow("Expected values to be strictly deep-equal");

  expect(() => {
    assert.deepStrictEqual(1, new Number(1));
  }).toThrow("Expected values to be strictly deep-equal");
});

test("assert.deepStrictEqual() should not compare Boolean wrapper with primitive", () => {
  // Wrapper objects should not equal primitives in strict mode
  expect(() => {
    assert.deepStrictEqual(new Boolean(true), true);
  }).toThrow("Expected values to be strictly deep-equal");

  expect(() => {
    assert.deepStrictEqual(false, new Boolean(false));
  }).toThrow("Expected values to be strictly deep-equal");
});

test("assert.deepStrictEqual() should not compare Number and Boolean wrappers", () => {
  // Different wrapper types should not be equal even with truthy/falsy values
  expect(() => {
    assert.deepStrictEqual(new Number(1), new Boolean(true));
  }).toThrow("Expected values to be strictly deep-equal");

  expect(() => {
    assert.deepStrictEqual(new Number(0), new Boolean(false));
  }).toThrow("Expected values to be strictly deep-equal");
});
