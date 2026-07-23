import { expect, test } from "bun:test";
import assert from "node:assert";

// https://github.com/oven-sh/bun/issues/34815
// Jest compares typed array elements with Object.is semantics:
// NaN equals NaN, and +0 is distinct from -0.
test("toEqual treats NaN elements of float typed arrays as equal", () => {
  expect(new Float16Array([NaN])).toEqual(new Float16Array([NaN]));
  expect(new Float32Array([NaN])).toEqual(new Float32Array([NaN]));
  expect(new Float64Array([NaN])).toEqual(new Float64Array([NaN]));
  expect(new Float16Array([1, NaN, 2])).toEqual(new Float16Array([1, NaN, 2]));
  expect(new Float32Array([1, NaN, 2])).toEqual(new Float32Array([1, NaN, 2]));
  expect(new Float64Array([1, NaN, 2])).toEqual(new Float64Array([1, NaN, 2]));

  expect(new Float16Array([NaN])).toStrictEqual(new Float16Array([NaN]));
  expect(new Float32Array([NaN])).toStrictEqual(new Float32Array([NaN]));
  expect(new Float64Array([NaN])).toStrictEqual(new Float64Array([NaN]));

  expect(new Float64Array([NaN])).not.toEqual(new Float64Array([1]));
  expect(new Float64Array([1])).not.toEqual(new Float64Array([NaN]));
  expect(new Float32Array([1])).not.toEqual(new Float32Array([2]));
});

test("toEqual distinguishes +0 and -0 in float typed arrays", () => {
  expect(new Float16Array([-0])).not.toEqual(new Float16Array([0]));
  expect(new Float32Array([-0])).not.toEqual(new Float32Array([0]));
  expect(new Float64Array([-0])).not.toEqual(new Float64Array([0]));
  expect(new Float64Array([-0])).toEqual(new Float64Array([-0]));
  expect(new Float64Array([0])).toEqual(new Float64Array([0]));
});

// node's loose deepEqual keeps == semantics for float typed arrays:
// NaN differs from NaN, +0 equals -0. Strict mode compares bytes.
test("node:assert float typed array semantics are unchanged", () => {
  assert.deepEqual(new Float64Array([-0]), new Float64Array([0]));
  assert.throws(() => assert.deepEqual(new Float64Array([NaN]), new Float64Array([NaN])));
  assert.deepStrictEqual(new Float64Array([NaN]), new Float64Array([NaN]));
  assert.throws(() => assert.deepStrictEqual(new Float64Array([-0]), new Float64Array([0])));

  expect(Bun.deepEquals(new Float64Array([-0]), new Float64Array([0]), false)).toBe(true);
  expect(Bun.deepEquals(new Float64Array([NaN]), new Float64Array([NaN]), false)).toBe(false);
  expect(Bun.deepEquals(new Float64Array([NaN]), new Float64Array([NaN]), true)).toBe(true);
});
