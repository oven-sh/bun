import { describe, expect, test } from "bun:test";

// %TypedArray%.prototype.indexOf / lastIndexOf compare with IsStrictlyEqual and includes with
// SameValueZero, on Number values. A needle that the element type cannot hold exactly is equal
// to no element, so it must not match the element it would round to when stored.

type FloatArray = Float16Array | Float32Array | Float64Array;

function search(array: FloatArray, needle: number) {
  return { indexOf: array.indexOf(needle), lastIndexOf: array.lastIndexOf(needle), includes: array.includes(needle) };
}

/** The expected result of search() when the only match is at `index` (-1 for none). */
const at = (index: number) => ({ indexOf: index, lastIndexOf: index, includes: index !== -1 });

const scratch = new Float64Array(1);
/** The same number, read back from a Float64Array so that JSC holds it as a double rather than an int32. */
function asDouble(value: number): number {
  scratch[0] = value;
  return scratch[0];
}

describe("integer needle that the element type cannot represent", () => {
  // The needles below are integer literals at the call site on purpose: JSC encodes those as
  // int32, which is the path that skipped the representability check.

  test("Float32Array", () => {
    const array = new Float32Array([16777216, 2147483648, -16777216, -2147483648, 1]);
    // 24-bit significand: 2^24 + 1 rounds to 2^24 and 2^31 - 1 rounds to 2^31 as a float.
    expect(search(array, 16777216)).toEqual(at(0));
    expect(search(array, 16777217)).toEqual(at(-1));
    expect(search(array, 2147483647)).toEqual(at(-1));
    expect(search(array, 2147483648)).toEqual(at(1));
    expect(search(array, -16777216)).toEqual(at(2));
    expect(search(array, -16777217)).toEqual(at(-1));
    expect(search(array, -2147483647)).toEqual(at(-1));
    expect(search(array, -2147483648)).toEqual(at(3));
    expect(search(array, 1)).toEqual(at(4));
  });

  test("Float16Array", () => {
    const array = new Float16Array([Infinity, 2048, 65504, -Infinity, -2048, 1]);
    // 11-bit significand, largest finite value 65504: 2049 rounds to 2048, 65505..65519 round to
    // 65504, and 65520 and above become Infinity as a half.
    expect(search(array, Infinity)).toEqual(at(0));
    expect(search(array, 65520)).toEqual(at(-1));
    expect(search(array, 65535)).toEqual(at(-1));
    expect(search(array, 65536)).toEqual(at(-1));
    expect(search(array, 2147483647)).toEqual(at(-1));
    expect(search(array, 2048)).toEqual(at(1));
    expect(search(array, 2049)).toEqual(at(-1));
    expect(search(array, 65504)).toEqual(at(2));
    expect(search(array, 65505)).toEqual(at(-1));
    expect(search(array, 65519)).toEqual(at(-1));
    expect(search(array, -Infinity)).toEqual(at(3));
    expect(search(array, -65520)).toEqual(at(-1));
    expect(search(array, -2147483648)).toEqual(at(-1));
    expect(search(array, -2048)).toEqual(at(4));
    expect(search(array, -2049)).toEqual(at(-1));
    expect(search(array, 1)).toEqual(at(5));
  });

  test("Float64Array holds every int32 exactly", () => {
    const array = new Float64Array([2147483647, -2147483648, 16777217]);
    expect(search(array, 2147483647)).toEqual(at(0));
    expect(search(array, -2147483648)).toEqual(at(1));
    expect(search(array, 16777217)).toEqual(at(2));
    expect(search(array, 16777216)).toEqual(at(-1));
  });

  test("integer arithmetic and parseInt results behave like the literal", () => {
    const array = new Float32Array([16777216]);
    expect(array.indexOf(16777216.5 + 0.5)).toBe(-1);
    expect(array.indexOf(parseInt("16777217"))).toBe(-1);
    expect(array.indexOf(16777216 | 1)).toBe(-1);
    expect(array.includes(2 ** 24 + 1)).toBe(false);
  });

  test("the same needle held as a double gives the same answer", () => {
    // This path already did the check. It is here so that both encodings stay in agreement.
    const f32 = new Float32Array([16777216, 2147483648]);
    expect(search(f32, asDouble(16777217))).toEqual(at(-1));
    expect(search(f32, asDouble(2147483647))).toEqual(at(-1));
    expect(search(f32, asDouble(16777216))).toEqual(at(0));
    expect(search(f32, 16777216.5)).toEqual(at(-1));
    const f16 = new Float16Array([Infinity, 2048, 65504]);
    expect(search(f16, asDouble(65520))).toEqual(at(-1));
    expect(search(f16, asDouble(2049))).toEqual(at(-1));
    expect(search(f16, asDouble(65505))).toEqual(at(-1));
    expect(search(f16, asDouble(65504))).toEqual(at(2));
  });
});
