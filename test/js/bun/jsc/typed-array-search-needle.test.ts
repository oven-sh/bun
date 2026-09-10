import { describe, expect, test } from "bun:test";

// %TypedArray%.prototype.indexOf / lastIndexOf compare with IsStrictlyEqual and includes with
// SameValueZero. A search value the element type cannot represent exactly matches nothing. JSC
// converts the search value to the element type once and scans raw storage, and three paths of that
// conversion wrapped, rounded or truncated the value instead (oven-sh/WebKit#609).

type AnyTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float16Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

function search(array: AnyTypedArray, needle: unknown) {
  const a = array as any;
  return [a.indexOf(needle), a.lastIndexOf(needle), a.includes(needle)];
}

// A Float64Array element read always yields a double-encoded value, also for integers such as -1 or
// 256 that a literal would encode as an int32. This is what puts a needle on the double path.
const box = new Float64Array(1);
function asDouble(n: number) {
  box[0] = n;
  return box[0];
}

describe("TypedArray indexOf / lastIndexOf / includes with an unrepresentable search value", () => {
  test("Uint8ClampedArray: a double outside 0..255 matches nothing", () => {
    const array = new Uint8ClampedArray([7, 0, 255]);
    // In release builds each of these matched the low byte of cvttsd2si(needle): -1 found the 255,
    // the others found the 0.
    for (const needle of [
      -1,
      256,
      263,
      -249,
      300,
      1e10,
      -1e10,
      2 ** 31,
      -(2 ** 31),
      2 ** 31 - 1,
      2 ** 32,
      2 ** 53,
      Infinity,
      -Infinity,
      Number.MAX_VALUE,
    ]) {
      expect(search(array, asDouble(needle)), `needle ${needle}`).toEqual([-1, -1, false]);
    }
    for (const needle of [0.5, -0.5, 7.5, 255.5, Number.MIN_VALUE]) {
      expect(search(array, needle), `needle ${needle}`).toEqual([-1, -1, false]);
    }
    expect(search(array, NaN)).toEqual([-1, -1, false]);
    // The same values read out of a double-backed array literal, as in the original report.
    const needles = [1e10, 2 ** 31, Infinity, 2147483647, 256, -1, 0.5];
    for (let i = 0; i < needles.length; i++) {
      expect(search(array, needles[i]), `needle ${needles[i]}`).toEqual([-1, -1, false]);
    }
    // Representable doubles are still found, and -0 is SameValueZero / strictly equal to 0.
    expect(search(array, asDouble(7))).toEqual([0, 0, true]);
    expect(search(array, asDouble(255))).toEqual([2, 2, true]);
    expect(search(array, -0)).toEqual([1, 1, true]);
  });

  test("Uint8ClampedArray: a negated int32 stays unmatched once the JIT hands it over as a double", () => {
    // Cold, `-i` is an int32 and took the (correct) int32 path. Once the negate has produced -0, the
    // optimizing tiers represent its result as a double, so the same call reaches the double path that
    // wrapped: in release builds hot(6) started returning 3 (the 250) after about 13k iterations.
    const array = new Uint8ClampedArray([0, 3, 6, 250, 255]);
    const hot = (i: number) => array.indexOf(-i);
    for (let k = 0; k < 10; k++) hot(0);
    const wrong: number[] = [];
    for (let i = 0; i < 30000; i++) {
      const n = i % 300;
      if (hot(n) !== -1 && n !== 0) wrong.push(n);
    }
    expect(wrong).toEqual([]);
    expect([hot(6), hot(250), hot(1), hot(0), hot(-3), hot(-250)]).toEqual([-1, -1, -1, 0, 1, 3]);
  });

  test("integer element types: a double outside the type's range matches nothing", () => {
    const cases: [AnyTypedArray, number[]][] = [
      [new Int8Array([7, 0, -1, -128, 127]), [255, 128, -129, 383]],
      [new Uint8Array([7, 0, 255]), [-1, 256, 511, -249]],
      [new Int16Array([7, 0, -1, -32768, 32767]), [65535, 32768, -32769, 65543]],
      [new Uint16Array([7, 0, 65535]), [-1, 65536, 65543, -65529]],
      [new Int32Array([7, 0, -1, -(2 ** 31), 2 ** 31 - 1]), [2 ** 31, 2 ** 32 - 1, -(2 ** 31) - 1, 2 ** 32 + 7]],
      [new Uint32Array([7, 0, 2 ** 32 - 1, 2 ** 31]), [-1, 2 ** 32, 2 ** 32 + 7, -(2 ** 31)]],
    ];
    for (const [array, missing] of cases) {
      const name = array.constructor.name;
      for (const needle of [...missing, 1e10, -1e10, 2 ** 53, 2 ** 64, Infinity, -Infinity, 0.5, 7.5]) {
        expect(search(array, needle), `${name} needle ${needle}`).toEqual([-1, -1, false]);
        expect(search(array, asDouble(needle)), `${name} double needle ${needle}`).toEqual([-1, -1, false]);
      }
      (array as any).forEach((element: number, index: number) => {
        expect(search(array, element), `${name} element ${element}`).toEqual([index, index, true]);
        expect(search(array, asDouble(element)), `${name} double element ${element}`).toEqual([index, index, true]);
      });
      expect(search(array, -0), `${name} -0`).toEqual([1, 1, true]);
    }
  });

  test("Float32Array: an integer a float cannot hold matches nothing", () => {
    const array = new Float32Array([
      16777216,
      2 ** 31,
      -0,
      Infinity,
      0.1,
      3.4028234663852886e38,
      -16777216,
      -(2 ** 31),
    ]);
    // 2^24 + 1 was rounded to 2^24 and INT32_MAX to 2^31, and both were "found". The integer literals
    // are int32-encoded, which is the path that skipped the check. asDouble() takes the other path.
    expect(search(array, 16777217)).toEqual([-1, -1, false]);
    expect(search(array, asDouble(16777217))).toEqual([-1, -1, false]);
    expect(search(array, -16777217)).toEqual([-1, -1, false]);
    expect(search(array, 2147483647)).toEqual([-1, -1, false]);
    expect(search(array, asDouble(2147483647))).toEqual([-1, -1, false]);
    expect(search(array, -2147483647)).toEqual([-1, -1, false]);
    expect(search(array, 16777216.5)).toEqual([-1, -1, false]);
    // The same integer out of arithmetic or parseInt behaves like the literal.
    expect(search(array, 16777216.5 + 0.5)).toEqual([-1, -1, false]);
    expect(search(array, parseInt("16777217"))).toEqual([-1, -1, false]);
    expect(search(array, 16777216 | 1)).toEqual([-1, -1, false]);
    expect(search(array, 2 ** 24 + 1)).toEqual([-1, -1, false]);
    expect(search(array, 16777216)).toEqual([0, 0, true]);
    expect(search(array, asDouble(16777216))).toEqual([0, 0, true]);
    expect(search(array, asDouble(2 ** 31))).toEqual([1, 1, true]);
    expect(search(array, 0)).toEqual([2, 2, true]);
    expect(search(array, -0)).toEqual([2, 2, true]);
    expect(search(array, Infinity)).toEqual([3, 3, true]);
    // The element is Math.fround(0.1), not the double 0.1.
    expect(search(array, 0.1)).toEqual([-1, -1, false]);
    expect(search(array, Math.fround(0.1))).toEqual([4, 4, true]);
    expect(search(array, 3.4028234663852886e38)).toEqual([5, 5, true]);
    expect(search(array, 1e300)).toEqual([-1, -1, false]);
    expect(search(array, Number.MAX_VALUE)).toEqual([-1, -1, false]);
    expect(search(array, -16777216)).toEqual([6, 6, true]);
    expect(search(array, -2147483648)).toEqual([7, 7, true]);
    expect(search(new Float32Array([1, NaN]), NaN)).toEqual([-1, -1, true]);
  });

  test("Float16Array: an integer a half float cannot hold matches nothing", () => {
    const array = new Float16Array([2048, 65504, -0, Infinity, -Infinity, -65504, -2048]);
    // 2049 was rounded to 2048 and 65505..65519 to 65504, and 65520 and above / INT32_MAX / INT32_MIN
    // became +/-Infinity. Each was "found".
    expect(search(array, 2049)).toEqual([-1, -1, false]);
    expect(search(array, asDouble(2049))).toEqual([-1, -1, false]);
    expect(search(array, -2049)).toEqual([-1, -1, false]);
    expect(search(array, 65505)).toEqual([-1, -1, false]);
    expect(search(array, asDouble(65505))).toEqual([-1, -1, false]);
    expect(search(array, 65519)).toEqual([-1, -1, false]);
    expect(search(array, 65520)).toEqual([-1, -1, false]);
    expect(search(array, asDouble(65520))).toEqual([-1, -1, false]);
    expect(search(array, 65535)).toEqual([-1, -1, false]);
    expect(search(array, 65536)).toEqual([-1, -1, false]);
    expect(search(array, -65520)).toEqual([-1, -1, false]);
    expect(search(array, -65536)).toEqual([-1, -1, false]);
    expect(search(array, 2147483647)).toEqual([-1, -1, false]);
    expect(search(array, -2147483648)).toEqual([-1, -1, false]);
    expect(search(array, 1e300)).toEqual([-1, -1, false]);
    expect(search(array, 2048)).toEqual([0, 0, true]);
    expect(search(array, asDouble(2048))).toEqual([0, 0, true]);
    expect(search(array, 65504)).toEqual([1, 1, true]);
    expect(search(array, asDouble(65504))).toEqual([1, 1, true]);
    expect(search(array, 0)).toEqual([2, 2, true]);
    expect(search(array, Infinity)).toEqual([3, 3, true]);
    expect(search(array, -Infinity)).toEqual([4, 4, true]);
    expect(search(array, -65504)).toEqual([5, 5, true]);
    expect(search(array, -2048)).toEqual([6, 6, true]);
    expect(search(new Float16Array([1, NaN]), NaN)).toEqual([-1, -1, true]);
  });

  test("Float64Array: int32 search values are exact", () => {
    const array = new Float64Array([16777217, 2147483647, -0, 2 ** 53, -2147483648]);
    expect(search(array, 16777217)).toEqual([0, 0, true]);
    expect(search(array, 2147483647)).toEqual([1, 1, true]);
    expect(search(array, 0)).toEqual([2, 2, true]);
    expect(search(array, 2 ** 53)).toEqual([3, 3, true]);
    expect(search(array, -2147483648)).toEqual([4, 4, true]);
    expect(search(array, 16777216)).toEqual([-1, -1, false]);
    expect(search(array, 2 ** 53 + 2)).toEqual([-1, -1, false]);
    // A BigInt is never strictly equal to a Number element.
    expect(search(array, 2n ** 53n)).toEqual([-1, -1, false]);
  });

  test("BigInt64Array: a BigInt outside [-2^63, 2^63) matches nothing", () => {
    const array = new BigInt64Array([1n, 0n, -1n, -(2n ** 63n), 2n ** 63n - 1n, 2n ** 32n, -(2n ** 32n)]);
    // Each of these was reduced modulo 2^64 onto one of the elements.
    for (const needle of [
      2n ** 64n + 1n,
      2n ** 64n,
      -(2n ** 64n),
      -(2n ** 64n) + 1n,
      2n ** 64n - 1n,
      2n ** 63n,
      -(2n ** 63n) - 1n,
      2n ** 128n + 1n,
      (1n << 200n) - 1n,
      -(1n << 200n) - 1n,
      -(1n << 200n) + 1n,
    ]) {
      expect(search(array, needle), `needle ${needle}`).toEqual([-1, -1, false]);
    }
    expect(search(array, 1n)).toEqual([0, 0, true]);
    expect(search(array, 0n)).toEqual([1, 1, true]);
    expect(search(array, -1n)).toEqual([2, 2, true]);
    expect(search(array, -(2n ** 63n))).toEqual([3, 3, true]);
    expect(search(array, 2n ** 63n - 1n)).toEqual([4, 4, true]);
    expect(search(array, 2n ** 32n)).toEqual([5, 5, true]);
    expect(search(array, -(2n ** 32n))).toEqual([6, 6, true]);
    expect(search(array, 2n)).toEqual([-1, -1, false]);
    // A Number or a string is never strictly equal to a BigInt element.
    expect(search(array, 1)).toEqual([-1, -1, false]);
    expect(search(array, "1")).toEqual([-1, -1, false]);
  });

  test("BigUint64Array: a BigInt outside [0, 2^64) matches nothing", () => {
    const array = new BigUint64Array([1n, 0n, 2n ** 64n - 1n, 2n ** 63n, 2n ** 63n - 1n, 2n ** 32n]);
    // Each of these was reduced modulo 2^64 onto one of the elements.
    for (const needle of [
      -1n,
      -(2n ** 63n),
      -(2n ** 63n) - 1n,
      2n ** 64n,
      2n ** 64n + 1n,
      -(2n ** 64n),
      -(2n ** 64n) + 1n,
      -(2n ** 64n) - 1n,
      2n ** 128n,
      (1n << 200n) + 1n,
      -(1n << 200n) + 1n,
    ]) {
      expect(search(array, needle), `needle ${needle}`).toEqual([-1, -1, false]);
    }
    expect(search(array, 1n)).toEqual([0, 0, true]);
    expect(search(array, 0n)).toEqual([1, 1, true]);
    expect(search(array, 2n ** 64n - 1n)).toEqual([2, 2, true]);
    expect(search(array, 2n ** 63n)).toEqual([3, 3, true]);
    expect(search(array, 2n ** 63n - 1n)).toEqual([4, 4, true]);
    expect(search(array, 2n ** 32n)).toEqual([5, 5, true]);
    expect(search(array, 2n)).toEqual([-1, -1, false]);
    // A Number is never strictly equal to a BigInt element, even one with the same mathematical value.
    expect(search(array, 0)).toEqual([-1, -1, false]);
    expect(search(array, 2 ** 63)).toEqual([-1, -1, false]);
  });

  test("BigInt64Array / BigUint64Array: the same through a subarray, a resizable or shared buffer, and with a fromIndex", () => {
    for (const constructor of [BigInt64Array, BigUint64Array]) {
      const elements = [7n, 3n, 7n, 7n, 3n];
      const byteLength = elements.length * 8;
      const padded = new constructor(elements.length + 2);
      padded.set(elements, 1);
      const resizable = new ArrayBuffer(byteLength, { maxByteLength: byteLength + 64 });
      const views = {
        plain: new constructor(elements),
        subarray: padded.subarray(1, elements.length + 1),
        lengthTracking: new constructor(resizable),
        fixedLength: new constructor(resizable, 0, elements.length),
        shared: new constructor(new SharedArrayBuffer(byteLength)),
      };
      views.lengthTracking.set(elements);
      views.shared.set(elements);
      // Both reduce to an element modulo 2^64.
      const seven = 7n + 2n ** 64n;
      const three = 3n - 2n ** 64n;
      for (const [kind, view] of Object.entries(views)) {
        const name = `${constructor.name} ${kind}`;
        expect(
          [
            view.indexOf(7n),
            view.lastIndexOf(7n),
            view.indexOf(7n, 1),
            view.lastIndexOf(7n, -3),
            view.includes(3n, -1),
          ],
          name,
        ).toEqual([0, 3, 2, 2, true]);
        expect([...search(view, seven), ...search(view, three)], name).toEqual([-1, -1, false, -1, -1, false]);
        expect([view.indexOf(seven, 1), view.lastIndexOf(seven, -3), view.includes(three, -1)], name).toEqual([
          -1,
          -1,
          false,
        ]);
      }
    }
  });
});
