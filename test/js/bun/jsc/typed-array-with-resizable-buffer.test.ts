// %TypedArray%.prototype.with(index, value) reads the length first, then
// coerces `index` and `value` (which can run user code), then copies every
// element other than `index` from the source. When a coercion grew the buffer
// under a length-tracking view, JSC's BigInt64Array / BigUint64Array returned
// a copy in which every element except the replaced one was 0.

import { describe, expect, test } from "bun:test";

type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Uint8ClampedArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float16ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor;

const constructors: TypedArrayConstructor[] = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float16Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
];

const isBigInt = (TA: TypedArrayConstructor) => TA === BigInt64Array || TA === BigUint64Array;
const isFloat = (TA: TypedArrayConstructor) => TA === Float16Array || TA === Float32Array || TA === Float64Array;
const convert = (TA: TypedArrayConstructor, n: number): any => (isBigInt(TA) ? BigInt(n) : n);

function makeBuffer(shared: boolean, byteLength: number, maxByteLength: number) {
  return shared ? new SharedArrayBuffer(byteLength, { maxByteLength }) : new ArrayBuffer(byteLength, { maxByteLength });
}

function growTo(buffer: ArrayBuffer | SharedArrayBuffer, byteLength: number) {
  if (buffer instanceof SharedArrayBuffer) buffer.grow(byteLength);
  else buffer.resize(byteLength);
}

// A length-tracking view over a fresh 4-element buffer that can grow to 8,
// filled with 10, 11, 12, 13.
function setup(TA: TypedArrayConstructor, shared: boolean, byteOffset = 0) {
  const bpe = TA.BYTES_PER_ELEMENT;
  const buffer = makeBuffer(shared, 4 * bpe, 8 * bpe);
  const whole = new TA(buffer as ArrayBuffer);
  for (let i = 0; i < whole.length; i++) whole[i] = convert(TA, 10 + i);
  const view = byteOffset === 0 ? whole : new TA(buffer as ArrayBuffer, byteOffset);
  return { buffer, view, bpe };
}

const elements = (TA: TypedArrayConstructor, values: number[]) => values.map(v => convert(TA, v));

for (const shared of [false, true]) {
  const kind = shared ? "growable SharedArrayBuffer" : "resizable ArrayBuffer";

  describe.each(constructors.map(TA => [TA.name, TA] as const))(`%s.prototype.with over a ${kind}`, (_, TA) => {
    test("keeps the source elements when coercing value grows the buffer", () => {
      const { buffer, view, bpe } = setup(TA, shared);
      let calls = 0;
      const value = {
        valueOf() {
          calls++;
          growTo(buffer, 6 * bpe);
          return convert(TA, 1);
        },
      };
      const copy = view.with(0, value as any);
      expect(calls).toBe(1);
      expect(view.length).toBe(6);
      expect(copy).toBeInstanceOf(TA);
      expect(copy.buffer).toBeInstanceOf(ArrayBuffer);
      expect((copy.buffer as ArrayBuffer).resizable).toBe(false);
      expect([...copy]).toEqual(elements(TA, [1, 11, 12, 13]));
    });

    test("keeps the source elements when coercing index grows the buffer", () => {
      const { buffer, view, bpe } = setup(TA, shared);
      const index = {
        valueOf() {
          growTo(buffer, 8 * bpe);
          return 2;
        },
      };
      const copy = view.with(index as any, convert(TA, 1));
      expect([...copy]).toEqual(elements(TA, [10, 11, 1, 13]));
    });

    test("negative index, both coercions grow the buffer", () => {
      const { buffer, view, bpe } = setup(TA, shared);
      const index = {
        valueOf() {
          growTo(buffer, 5 * bpe);
          return -1;
        },
      };
      const value = {
        valueOf() {
          growTo(buffer, 7 * bpe);
          return convert(TA, 2);
        },
      };
      const copy = view.with(index as any, value as any);
      expect([...copy]).toEqual(elements(TA, [10, 11, 12, 2]));
    });

    test("length-tracking view with a byte offset", () => {
      const { buffer, view, bpe } = setup(TA, shared, TA.BYTES_PER_ELEMENT);
      expect(view.length).toBe(3);
      const value = {
        valueOf() {
          growTo(buffer, 8 * bpe);
          return convert(TA, 3);
        },
      };
      const copy = view.with(1, value as any);
      expect(view.length).toBe(7);
      expect([...copy]).toEqual(elements(TA, [11, 3, 13]));
    });

    // Shrinking inside the coercion, for contrast. This already behaved
    // correctly: elements past the new length read as undefined, so Number
    // arrays store ToNumber(undefined) and BigInt arrays throw on
    // ToBigInt(undefined). A SharedArrayBuffer cannot shrink.
    test.skipIf(shared)("coercing value shrinks the buffer", () => {
      const { buffer, view, bpe } = setup(TA, shared);
      const value = {
        valueOf() {
          (buffer as ArrayBuffer).resize(2 * bpe);
          return convert(TA, 5);
        },
      };
      if (isBigInt(TA)) {
        expect(() => view.with(1, value as any)).toThrow(TypeError);
      } else {
        const fill = isFloat(TA) ? NaN : 0;
        expect([...view.with(1, value as any)]).toEqual([10, 5, fill, fill]);
      }
      // The index itself going out of bounds is a RangeError for every type.
      const again = setup(TA, shared);
      const shrinkPastIndex = {
        valueOf() {
          (again.buffer as ArrayBuffer).resize(2 * again.bpe);
          return convert(TA, 5);
        },
      };
      expect(() => again.view.with(3, shrinkPastIndex as any)).toThrow(RangeError);
    });
  });
}
