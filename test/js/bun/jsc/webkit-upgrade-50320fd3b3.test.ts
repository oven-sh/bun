import { describe, expect, test } from "bun:test";

// Coverage for the WebKit 50320fd3b3 sync (oven-sh/WebKit#623). The first two cases pin
// an observable difference between the old and the new JavaScriptCore. The third runs the
// shapes the new B3 lowering matches through the JIT tiers.

describe.concurrent("WebKit 50320fd3b3 upgrade", () => {
  test("ArrayBuffer.prototype.resize range-checks the length before the detached check (223bd0faee)", () => {
    const detached = new ArrayBuffer(8, { maxByteLength: 16 });
    detached.transfer();
    expect(() => detached.resize(-1)).toThrow(RangeError);
    expect(() => detached.resize(2 ** 53)).toThrow(RangeError);
    // A length that passes ToIndex still reaches the detached check.
    expect(() => detached.resize(8)).toThrow(TypeError);

    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    expect(() => buffer.resize(1e20)).toThrow(RangeError);
    expect(() => buffer.resize(Infinity)).toThrow(RangeError);
    expect(() => buffer.resize(-1)).toThrow(RangeError);
    buffer.resize(16);
    expect(buffer.byteLength).toBe(16);
  });

  test("SharedArrayBuffer.prototype.grow rejects a length that is not an index (223bd0faee)", () => {
    const shared = new SharedArrayBuffer(8, { maxByteLength: 16 });
    expect(() => shared.grow(1e20)).toThrow(RangeError);
    expect(() => shared.grow(2 ** 53)).toThrow(RangeError);
    expect(() => shared.grow(-1)).toThrow(RangeError);
    shared.grow(16);
    expect(shared.byteLength).toBe(16);
  });

  test("a multiply with a negated operand keeps its value, sign of zero included (41ec81351b)", () => {
    const negLeft = (w: number, r: number) => -w * r;
    const negRight = (w: number, r: number) => w * -r;
    const negBoth = (w: number, r: number) => -w * -r;
    // The negation has two users here, so the multiply cannot absorb it.
    const sharedNeg = (w: number, r: number) => {
      const n = -w;
      return n * r + n;
    };
    const negLeftInt = (w: number, r: number) => (-w * r) | 0;

    // w, r, -w * r, w * -r, -w * -r
    const cases: [number, number, number, number, number][] = [
      [0, 3, -0, -0, 0],
      [-0, 3, 0, 0, -0],
      [0, -3, 0, 0, -0],
      [-0, -3, -0, -0, 0],
      [0, -0, 0, 0, -0],
      [0, Infinity, NaN, NaN, NaN],
      [2, Infinity, -Infinity, -Infinity, Infinity],
      [NaN, 3, NaN, NaN, NaN],
      [1.5, 2.5, -3.75, -3.75, 3.75],
      [-1.5, 2.5, 3.75, 3.75, -3.75],
      [Number.MAX_VALUE, 2, -Infinity, -Infinity, Infinity],
    ];
    // w, r, (-w * r) | 0
    const intCases: [number, number, number][] = [
      [3, 7, -21],
      [-3, 7, 21],
      [0x7fffffff, 2, 2],
      [-0x80000000, 2, 0],
      [0x10000, 0x10000, 0],
    ];

    const mismatches: string[] = [];
    const check = (actual: number, expected: number, what: string, w: number, r: number) => {
      if (!Object.is(actual, expected) && mismatches.length < 10)
        mismatches.push(`${what}(${w}, ${r}): got ${actual}, expected ${expected}`);
    };
    for (let i = 0; i < 1e4; ++i) {
      for (const [w, r, left, right, both] of cases) {
        check(negLeft(w, r), left, "negLeft", w, r);
        check(negRight(w, r), right, "negRight", w, r);
        check(negBoth(w, r), both, "negBoth", w, r);
        check(sharedNeg(w, r), left + -w, "sharedNeg", w, r);
      }
      for (const [w, r, expected] of intCases) check(negLeftInt(w, r), expected, "negLeftInt", w, r);
    }
    expect(mismatches).toEqual([]);
  });
});
