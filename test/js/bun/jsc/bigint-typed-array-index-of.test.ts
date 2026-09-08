import { describe, expect, test } from "bun:test";

// BigInt64Array / BigUint64Array .indexOf, .lastIndexOf and .includes compare
// the needle with each element's BigInt value (IsStrictlyEqual /
// SameValueZero). A BigInt the element type cannot represent never matches.
// JSC used to convert the needle with a wrapping ToBigInt64 / ToBigUint64, so
// a needle congruent to an element modulo 2^64 was reported as found:
// `new BigInt64Array([-1n]).includes(2n ** 64n - 1n)` was true.

const int64Max = 2n ** 63n - 1n;
const int64Min = -(2n ** 63n);
const uint64Max = 2n ** 64n - 1n;

type Case = [elements: bigint[], needle: bigint, expectedIndex: number];

const int64Cases: Case[] = [
  [[3n, -1n, 7n], 2n ** 64n - 1n, -1], // wraps to -1n
  [[3n, -1n, 7n], 2n ** 64n + 3n, -1], // wraps to 3n
  [[3n, -1n, 7n], -(2n ** 64n) + 7n, -1], // wraps to 7n
  [[3n, 0n, 7n], 2n ** 64n, -1], // wraps to 0n
  [[3n, 0n, 7n], -(2n ** 64n), -1], // wraps to 0n
  [[3n, 0n, 7n], 2n ** 128n, -1], // wraps to 0n
  [[3n, int64Min, 7n], 2n ** 63n, -1], // wraps to -2^63
  [[3n, int64Max, 7n], int64Min - 1n, -1], // wraps to 2^63 - 1
  [[3n, 5n, 7n], 2n ** 200n + 5n, -1], // many digits, low 64 bits are 5
  [[3n, -5n, 7n], -(2n ** 200n) - 5n, -1],
  // Representable needles still match, including the boundaries.
  [[3n, -1n, 7n], -1n, 1],
  [[3n, -1n, 7n], 3n, 0],
  [[3n, -1n, 7n], 7n, 2],
  [[3n, 0n, 7n], 0n, 1],
  [[3n, int64Max, 7n], int64Max, 1],
  [[3n, int64Min, 7n], int64Min, 1],
  [[3n, 2n ** 32n, 7n], 2n ** 32n, 1],
  [[3n, -(2n ** 32n), 7n], -(2n ** 32n), 1],
  [[3n, -1n, 7n], 4n, -1],
];

const uint64Cases: Case[] = [
  [[3n, uint64Max, 7n], -1n, -1], // wraps to 2^64 - 1
  [[3n, int64Max, 7n], int64Min - 1n, -1], // wraps to 2^63 - 1
  [[3n, 2n ** 63n, 7n], int64Min, -1], // wraps to 2^63
  [[3n, 0n, 7n], 2n ** 64n, -1], // wraps to 0n
  [[3n, 0n, 7n], -(2n ** 64n), -1], // wraps to 0n
  [[3n, 0n, 7n], 2n ** 128n, -1], // wraps to 0n
  [[3n, 5n, 7n], 2n ** 64n + 5n, -1], // wraps to 5n
  [[3n, 5n, 7n], -(2n ** 64n) + 5n, -1], // wraps to 5n
  [[3n, 5n, 7n], 2n ** 200n + 5n, -1],
  [[3n, uint64Max - 4n, 7n], -5n, -1], // wraps to 2^64 - 5
  // Representable needles still match, including the boundaries.
  [[3n, uint64Max, 7n], uint64Max, 1],
  [[3n, 0n, 7n], 0n, 1],
  [[3n, 2n ** 63n, 7n], 2n ** 63n, 1],
  [[3n, int64Max, 7n], int64Max, 1],
  [[3n, 2n ** 32n, 7n], 2n ** 32n, 1],
  [[3n, 5n, 7n], 3n, 0],
  [[3n, 5n, 7n], 7n, 2],
  [[3n, 5n, 7n], 4n, -1],
];

type BigIntArrayConstructor = BigInt64ArrayConstructor | BigUint64ArrayConstructor;

// The same elements seen through a plain view, a subarray, a length-tracking
// view of a resizable buffer, a fixed window of one, and a shared buffer.
function makeViews(constructor: BigIntArrayConstructor, elements: bigint[]) {
  const byteLength = elements.length * 8;

  const plain = new constructor(elements);

  const padded = new constructor(elements.length + 2);
  padded.set(elements, 1);
  const subarray = padded.subarray(1, elements.length + 1);

  const resizable = new ArrayBuffer(byteLength, { maxByteLength: byteLength + 64 });
  const tracking = new constructor(resizable);
  tracking.set(elements);
  const fixedWindow = new constructor(resizable, 0, elements.length);

  const shared = new constructor(new SharedArrayBuffer(byteLength));
  shared.set(elements);

  return { plain, subarray, tracking, fixedWindow, shared };
}

function search(array: BigInt64Array | BigUint64Array, needle: bigint) {
  return {
    indexOf: array.indexOf(needle),
    lastIndexOf: array.lastIndexOf(needle),
    includes: array.includes(needle),
    indexOfFrom1: array.indexOf(needle, 1),
    lastIndexOfFromMinus2: array.lastIndexOf(needle, -2),
    includesFromMinus1: array.includes(needle, -1),
    // The generic Array.prototype path was always correct. It is the reference.
    arrayIndexOf: Array.prototype.indexOf.call(array, needle),
    arrayIncludes: Array.prototype.includes.call(array, needle),
  };
}

function expected(length: number, index: number) {
  return {
    indexOf: index,
    lastIndexOf: index,
    includes: index !== -1,
    indexOfFrom1: index >= 1 ? index : -1,
    lastIndexOfFromMinus2: index <= length - 2 ? index : -1,
    includesFromMinus1: index === length - 1,
    arrayIndexOf: index,
    arrayIncludes: index !== -1,
  };
}

describe.each([
  ["BigInt64Array", BigInt64Array, int64Cases],
  ["BigUint64Array", BigUint64Array, uint64Cases],
] as const)("%s indexOf / lastIndexOf / includes", (_name, constructor, cases) => {
  test.each(
    cases.map(
      ([elements, needle, index]) => [`${needle}n`, `[${elements.join("n, ")}n]`, elements, needle, index] as const,
    ),
  )("needle %s in %s", (_needle, _elements, elements, needle, index) => {
    for (const [kind, view] of Object.entries(makeViews(constructor, elements))) {
      expect({ kind, ...search(view, needle) }).toEqual({ kind, ...expected(elements.length, index) });
    }
  });
});

test("a Number needle never matches a BigInt element and a BigInt needle never matches a Number element", () => {
  const i64 = new BigInt64Array([0n, 1n, -1n]);
  expect(i64.indexOf(1 as any)).toBe(-1);
  expect(i64.includes(-1 as any)).toBe(false);
  expect(i64.lastIndexOf("1" as any)).toBe(-1);
  const u64 = new BigUint64Array([0n, 1n, uint64Max]);
  expect(u64.indexOf((2 ** 64) as any)).toBe(-1);
  expect(u64.includes(18446744073709551615 as any)).toBe(false);
  const f64 = new Float64Array([0, 1, 2 ** 64]);
  expect(f64.indexOf((2n ** 64n) as any)).toBe(-1);
  expect(f64.includes(1n as any)).toBe(false);
});
