import { describe, expect, test } from "bun:test";

// Conformance tests for resizable ArrayBuffer / growable SharedArrayBuffer in JavaScriptCore.
// The expected results are what the spec, V8 and SpiderMonkey produce.

describe("%TypedArray%.prototype.filter on a BigInt array whose callback takes the view out of bounds", () => {
  // filter reads each element with TypedArrayGetElement before it calls the callback, so once the
  // view is out of bounds the remaining elements are undefined. The kept values are then stored
  // into the new array with TypedArraySetElement, which is ToBigInt(value) for a BigInt array,
  // and ToBigInt(undefined) throws a TypeError. JSC used to store 0n instead.

  // Typed as one constructor so that `class Derived extends TA` below type-checks. The tests only use
  // what the two BigInt array types share.
  const bigIntArrayConstructors = [BigInt64Array, BigUint64Array] as unknown as BigInt64ArrayConstructor[];

  for (const TA of bigIntArrayConstructors) {
    describe(TA.name, () => {
      test("shrink to zero mid-iteration", () => {
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new TA(buffer).fill(7n);
        const seen: unknown[] = [];
        expect(() =>
          array.filter((x, i) => {
            seen.push(x);
            if (i === 2) buffer.resize(0);
            return true;
          }),
        ).toThrow(TypeError);
        expect(seen).toEqual([7n, 7n, 7n, undefined, undefined]);
      });

      test("partial shrink", () => {
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new TA(buffer).fill(7n);
        expect(() =>
          array.filter((x, i) => {
            if (i === 0) buffer.resize(32);
            return true;
          }),
        ).toThrow(TypeError);
      });

      test("a fixed-length view on a resizable buffer goes out of bounds as a whole", () => {
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new TA(buffer, 8, 2).fill(7n);
        const seen: unknown[] = [];
        expect(() =>
          array.filter((x, i) => {
            seen.push(x);
            if (i === 0) buffer.resize(16);
            return true;
          }),
        ).toThrow(TypeError);
        expect(seen).toEqual([7n, undefined]);
      });

      test.each([
        ["resizable", { maxByteLength: 40 }],
        ["fixed-length", undefined],
      ] as const)("detach a %s buffer mid-iteration", (_, options) => {
        const buffer = new ArrayBuffer(40, options);
        const array = new TA(buffer).fill(7n);
        expect(() =>
          array.filter((x, i) => {
            if (i === 2) buffer.transfer();
            return true;
          }),
        ).toThrow(TypeError);
      });

      test("dropping the undefined elements does not throw", () => {
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new TA(buffer).fill(7n);
        const result = array.filter((x, i) => {
          if (i === 2) buffer.resize(0);
          return x !== undefined;
        });
        expect([...result]).toEqual([7n, 7n, 7n]);
        expect(result.buffer.resizable).toBe(false);
      });

      test("shrink, then grow back: the element read while out of bounds stays undefined", () => {
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new TA(buffer).fill(7n);
        const seen: unknown[] = [];
        expect(() =>
          array.filter((x, i) => {
            seen.push(x);
            if (i === 1) buffer.resize(8);
            if (i === 2) buffer.resize(40);
            return true;
          }),
        ).toThrow(TypeError);
        expect(seen).toEqual([7n, 7n, undefined, 0n, 0n]);
      });

      test("a callback that is not a plain function takes the same path", () => {
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new TA(buffer).fill(7n);
        const callback = new Proxy((x: bigint, i: number) => {
          if (i === 2) buffer.resize(0);
          return true;
        }, {});
        expect(() => array.filter(callback)).toThrow(TypeError);
      });

      test("every callback runs, then the species constructor, then the stores up to the first undefined", () => {
        const log: string[] = [];
        let created: BigInt64Array | undefined;
        class Derived extends TA {
          constructor(...args: [any, ...any[]]) {
            super(...args);
            log.push(`construct ${args[0]}`);
            created = this;
          }
        }
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new Derived(buffer);
        log.length = 0;
        array.fill(7n);
        expect(() =>
          array.filter((x, i) => {
            log.push(`callback ${i} ${x}`);
            if (i === 1) buffer.resize(8);
            if (i === 2) buffer.resize(40);
            return true;
          }),
        ).toThrow(TypeError);
        expect(log).toEqual([
          "callback 0 7",
          "callback 1 7",
          "callback 2 undefined",
          "callback 3 0",
          "callback 4 0",
          "construct 5",
        ]);
        expect(created!.length).toBe(5);
        expect([...created!]).toEqual([7n, 7n, 0n, 0n, 0n]);
      });

      test("a species result that already has contents keeps them past the first undefined", () => {
        const other = new TA(8).fill(3n);
        const buffer = new ArrayBuffer(40, { maxByteLength: 40 });
        const array = new TA(buffer).fill(7n);
        Object.defineProperty(array, "constructor", {
          value: {
            [Symbol.species]: function () {
              return other;
            },
          },
        });
        expect(() =>
          array.filter((x, i) => {
            if (i === 1) buffer.resize(0);
            return true;
          }),
        ).toThrow(TypeError);
        expect([...other]).toEqual([7n, 7n, 3n, 3n, 3n, 3n, 3n, 3n]);
      });
    });
  }

  test.each([
    [Float64Array, [7, 7, 7, NaN, NaN]],
    [Float32Array, [7, 7, 7, NaN, NaN]],
    [Int32Array, [7, 7, 7, 0, 0]],
    [Uint16Array, [7, 7, 7, 0, 0]],
    [Uint8ClampedArray, [7, 7, 7, 0, 0]],
    [Int8Array, [7, 7, 7, 0, 0]],
  ] as const)("%p stores ToNumber(undefined) and does not throw", (TA, expected) => {
    const size = 5 * TA.BYTES_PER_ELEMENT;
    for (const takeOutOfBounds of [(b: ArrayBuffer) => b.resize(0), (b: ArrayBuffer) => b.transfer()]) {
      const buffer = new ArrayBuffer(size, { maxByteLength: size });
      const array = new TA(buffer).fill(7);
      const result = array.filter((x, i) => {
        if (i === 2) takeOutOfBounds(buffer);
        return true;
      });
      expect([...result]).toEqual([...expected]);
    }
  });
});

describe.each([ArrayBuffer, SharedArrayBuffer])("%p constructor with maxByteLength", ArrayBufferConstructor => {
  // The constructor is ToIndex(length), then GetArrayBufferMaxByteLengthOption(options), then
  // AllocateArrayBuffer, which throws a RangeError if byteLength > maxByteLength. The comparison
  // is between the two integers, so a fractional length that truncates to <= maxByteLength is
  // fine. JSC used to compare maxByteLength with the untruncated number.
  const isShared = ArrayBufferConstructor === SharedArrayBuffer;
  const resizable = (buffer: ArrayBuffer | SharedArrayBuffer) =>
    isShared ? (buffer as SharedArrayBuffer).growable : (buffer as ArrayBuffer).resizable;

  test.each([
    [1.5, 1, 1, 1],
    [2.5, 2, 2, 2],
    [1.9999999, 1, 1, 1],
    ["1.5", 1, 1, 1],
    ["0x10", 16.5, 16, 16],
    [0.5, 0, 0, 0],
    [-0.5, 0, 0, 0],
    [0.9, 0.1, 0, 0],
    [8.75, 8.25, 8, 8],
    [true, 1.5, 1, 1],
    [null, 0.5, 0, 0],
    [NaN, NaN, 0, 0],
    [4.5, 16, 4, 16],
  ] as [unknown, unknown, number, number][])(
    "length %p, maxByteLength %p",
    (length, maxByteLength, expectedByteLength, expectedMaxByteLength) => {
      // @ts-ignore
      const buffer = new ArrayBufferConstructor(length, { maxByteLength });
      expect(buffer.byteLength).toBe(expectedByteLength);
      expect(buffer.maxByteLength).toBe(expectedMaxByteLength);
      expect(resizable(buffer)).toBe(true);
    },
  );

  test("objects are converted once each and compared after truncation", () => {
    let lengthCalls = 0;
    let maxCalls = 0;
    const buffer = new ArrayBufferConstructor(
      // @ts-ignore
      {
        valueOf() {
          lengthCalls++;
          return 1.7;
        },
      },
      {
        maxByteLength: {
          valueOf() {
            maxCalls++;
            return 1.2;
          },
        },
      },
    );
    expect(buffer.byteLength).toBe(1);
    expect(buffer.maxByteLength).toBe(1);
    expect([lengthCalls, maxCalls]).toEqual([1, 1]);
  });

  test.each([
    [2, 1],
    [2, 1.9],
    [1.5, 0.9],
    ["2", "1"],
  ])("length %p still exceeds maxByteLength %p", (length, maxByteLength) => {
    // @ts-ignore
    expect(() => new ArrayBufferConstructor(length, { maxByteLength })).toThrow(RangeError);
  });

  test("ToIndex(length) completes before options.maxByteLength and newTarget.prototype are read", () => {
    const log: string[] = [];
    const options = {
      get maxByteLength() {
        log.push("maxByteLength");
        return 8;
      },
    };
    const newTarget = function () {}.bind(undefined);
    Object.defineProperty(newTarget, "prototype", {
      get() {
        log.push("prototype");
        return ArrayBufferConstructor.prototype;
      },
    });

    expect(Reflect.construct(ArrayBufferConstructor, [4.5, options], newTarget).byteLength).toBe(4);
    expect(log).toEqual(["maxByteLength", "prototype"]);

    log.length = 0;
    expect(() => Reflect.construct(ArrayBufferConstructor, [-1, options], newTarget)).toThrow(RangeError);
    expect(() => Reflect.construct(ArrayBufferConstructor, [-1.5, options], newTarget)).toThrow(RangeError);
    expect(() => Reflect.construct(ArrayBufferConstructor, [2 ** 53, options], newTarget)).toThrow(RangeError);
    expect(log).toEqual([]);

    // byteLength > maxByteLength is checked before newTarget.prototype is read ...
    expect(() => Reflect.construct(ArrayBufferConstructor, [16, options], newTarget)).toThrow(RangeError);
    expect(log).toEqual(["maxByteLength"]);

    // ... and a length that passes ToIndex but cannot be allocated fails after it.
    log.length = 0;
    expect(() => Reflect.construct(ArrayBufferConstructor, [2 ** 53 - 1], newTarget)).toThrow(RangeError);
    expect(log).toEqual(["prototype"]);
  });

  test("without maxByteLength nothing changes", () => {
    expect(new ArrayBufferConstructor(1.5).byteLength).toBe(1);
    // @ts-ignore
    expect(new ArrayBufferConstructor("7").byteLength).toBe(7);
    // @ts-ignore
    expect(new ArrayBufferConstructor().byteLength).toBe(0);
    // @ts-ignore
    expect(new ArrayBufferConstructor(3.5, { maxByteLength: undefined }).byteLength).toBe(3);
    // @ts-ignore
    expect(resizable(new ArrayBufferConstructor(3.5, {}))).toBe(false);
    expect(() => new ArrayBufferConstructor(-1)).toThrow(RangeError);
  });
});
