import assert from "assert";
import { describe, expect, test } from "bun:test";

function makeBlock(f: Function, ...args: any[]) {
  return function () {
    return f.apply(this, args);
  };
}

describe("TypedArray deepEqual", () => {
  describe("equalArrayPairs", () => {
    const equalArrayPairs = [
      [new Uint8Array(1e5), new Uint8Array(1e5)],
      [new Uint16Array(1e5), new Uint16Array(1e5)],
      [new Uint32Array(1e5), new Uint32Array(1e5)],
      [new Uint8ClampedArray(1e5), new Uint8ClampedArray(1e5)],
      [new Int8Array(1e5), new Int8Array(1e5)],
      [new Int16Array(1e5), new Int16Array(1e5)],
      [new Int32Array(1e5), new Int32Array(1e5)],
      [new Float32Array(1e5), new Float32Array(1e5)],
      [new Float64Array(1e5), new Float64Array(1e5)],
      [new Float32Array([+0.0]), new Float32Array([+0.0])],
      [new Uint8Array([1, 2, 3, 4]).subarray(1), new Uint8Array([2, 3, 4])],
      [new Uint16Array([1, 2, 3, 4]).subarray(1), new Uint16Array([2, 3, 4])],
      [new Uint32Array([1, 2, 3, 4]).subarray(1, 3), new Uint32Array([2, 3])],
      [new ArrayBuffer(3), new ArrayBuffer(3)],
      [new SharedArrayBuffer(3), new SharedArrayBuffer(3)],
    ];

    for (const arrayPair of equalArrayPairs) {
      test(`${arrayPair[0].constructor.name} should equal`, () => {
        assert.deepEqual(arrayPair[0], arrayPair[1]);
        assert.deepStrictEqual(arrayPair[0], arrayPair[1]);
      });
    }
  });

  describe("looseEqualArrayPairs", () => {
    const looseEqualArrayPairs = [
      // @ts-ignore
      [new Float16Array([+0.0]), new Float16Array([-0.0])],
      [new Float32Array([+0.0]), new Float32Array([-0.0])],
      [new Float64Array([+0.0]), new Float64Array([-0.0])],
    ];

    for (const arrayPair of looseEqualArrayPairs) {
      test(`${arrayPair[0].constructor.name} should be loosely equal but not strictly equal`, () => {
        assert.deepEqual(arrayPair[0], arrayPair[1]);
        expect(() => assert.deepStrictEqual(arrayPair[0], arrayPair[1])).toThrow(assert.AssertionError);
      });
    }
  });

  describe("looseNotEqualArrayPairs", () => {
    const looseNotEqualArrayPairs = [
      // @ts-ignore
      [new Float16Array([NaN]), new Float16Array([NaN])],
      [new Float32Array([NaN]), new Float32Array([NaN])],
      [new Float64Array([NaN]), new Float64Array([NaN])],
    ];

    for (const arrayPair of looseNotEqualArrayPairs) {
      test(`${arrayPair[0].constructor.name} should be strictly equal but not loosely equal`, () => {
        expect(() => assert.deepEqual(arrayPair[0], arrayPair[1])).toThrow(assert.AssertionError);
        assert.deepStrictEqual(arrayPair[0], arrayPair[1]);
      });
    }
  });

  describe("notEqualArrayPairs", () => {
    const notEqualArrayPairs = [
      [new ArrayBuffer(3), new SharedArrayBuffer(3)],
      [new Int16Array(256), new Uint16Array(256)],
      [new Int16Array([256]), new Uint16Array([256])],
      [new Float64Array([+0.0]), new Float32Array([-0.0])],
      [new Uint8Array(2), new Uint8Array(3)],
      [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])],
      [new Uint8ClampedArray([300, 2, 3]), new Uint8Array([300, 2, 3])],
      [new Uint16Array([2]), new Uint16Array([3])],
      [new Uint16Array([0]), new Uint16Array([256])],
      [new Int16Array([0]), new Uint16Array([256])],
      [new Int16Array([-256]), new Uint16Array([0xff00])], // same bits
      [new Int32Array([-256]), new Uint32Array([0xffffff00])], // ditto
      [new Float32Array([0.1]), new Float32Array([0.0])],
      [new Float32Array([0.1]), new Float32Array([0.1, 0.2])],
      [new Float64Array([0.1]), new Float64Array([0.0])],
      [new Uint8Array([1, 2, 3]).buffer, new Uint8Array([4, 5, 6]).buffer],
      [
        new Uint8Array(new SharedArrayBuffer(3)).fill(1).buffer,
        new Uint8Array(new SharedArrayBuffer(3)).fill(2).buffer,
      ],
      [new ArrayBuffer(2), new ArrayBuffer(3)],
      [new SharedArrayBuffer(2), new SharedArrayBuffer(3)],
      [new ArrayBuffer(2), new SharedArrayBuffer(3)],
      [new Uint8Array(new ArrayBuffer(3)).fill(1).buffer, new Uint8Array(new SharedArrayBuffer(3)).fill(2).buffer],
      [new ArrayBuffer(3), new SharedArrayBuffer(3)],
      [new SharedArrayBuffer(2), new ArrayBuffer(2)],
    ];

    for (const arrayPair of notEqualArrayPairs) {
      test(`${arrayPair[0].constructor.name} should not equal ${arrayPair[1].constructor.name}`, () => {
        expect(() => assert.deepEqual(arrayPair[0], arrayPair[1])).toThrow(assert.AssertionError);
        expect(() => assert.deepStrictEqual(arrayPair[0], arrayPair[1])).toThrow(assert.AssertionError);
      });
    }
  });
});

test("assert.deepStrictEqual diff message stays bounded for large arrays with many differing elements", () => {
  // Two 20,000-element arrays that differ at every 40th index. Their inspected
  // forms are ~20,002 lines each and the shortest edit script between them is
  // ~1,000 insert/delete operations, which is well past the point where the
  // native myers diff must stop retaining a per-level trace frame (each frame
  // is ~320 KB here). The AssertionError message must stay a small truncated
  // preview instead of growing with the size and difference count of the
  // operands.
  const length = 20_000;
  const actual = Array.from({ length }, (_, i) => i);
  const expected = actual.slice();
  for (let i = 0; i < length; i += 40) {
    expected[i] = -1;
  }

  let error: Error | undefined;
  try {
    assert.deepStrictEqual(actual, expected);
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeInstanceOf(assert.AssertionError);
  expect(error!.message).toContain("Expected values to be strictly deep-equal");
  // The message is a truncated preview of the first lines of the inspected
  // value, not a line-by-line diff of all 20,000 elements: it stays small and
  // does not include entries from the tail of the arrays.
  expect(error!.message.split("\n").length).toBeLessThan(100);
  expect(error!.message).not.toContain("19960");

  // Identical large arrays still compare equal without throwing.
  expect(() => assert.deepStrictEqual(actual, actual.slice())).not.toThrow();
}, 30_000);
