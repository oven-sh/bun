import { edenGC, fullGC } from "bun:jsc";
import { describe, expect, test } from "bun:test";

// Coverage for the WebKit 6b58d86abe sync (oven-sh/WebKit#651). The first two cases pin
// an observable difference between the old and the new JavaScriptCore. The others run
// code the range rewrote (the B3 lowering of a negated multiply, WeakGCMap, and the
// bounds hints in the BigInt multiply and divide loops) and check that results hold.

describe.concurrent("WebKit 6b58d86abe upgrade", () => {
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

  test("a WeakGCMap keeps an entry whose value is alive across eden and full collections (8ae0649a80)", () => {
    // Port of JSTests/stress/weak-gc-map-keeps-live-values.js. Symbol.for reads
    // VM::symbolImplToSymbolMap, which is a WeakGCMap. If a collection drops an entry whose
    // value is reachable, the next lookup makes a second Symbol cell for the same key.
    const symbols: symbol[] = [];
    for (let i = 0; i < 128; ++i) symbols.push(Symbol.for(`webkit-upgrade-6b58d86abe-${i}`));

    const changed: number[] = [];
    for (let i = 0; i < 16; ++i) {
      // New structure transitions, prototype structures and atom strings, so that the weak
      // tables gain entries between collections and eden collections visit them.
      for (let j = 0; j < 512; ++j) {
        const object: Record<string, number> = {};
        object[`p${j & 31}`] = j;
        object.tail = j;
        Object.create(object);
        `a,b,c-${j}`.split(",");
      }
      if (i & 1) edenGC();
      else fullGC();
      for (let j = 0; j < symbols.length; ++j) {
        if (Symbol.for(`webkit-upgrade-6b58d86abe-${j}`) !== symbols[j]) changed.push(j);
      }
    }
    expect(changed).toEqual([]);
  });

  test("BigInt multiply and divide agree on operands that reach the Karatsuba and schoolbook loops (9e61914f4c)", () => {
    // karatsubaStart() runs its chunk loop only when the operands have different lengths, and
    // divideSchoolbook() handles every divisor of 2 to 56 digits. A digit is 64 bits.
    const digits = (count: number, seed: bigint) => {
      let value = 0n;
      let state = seed;
      for (let i = 0; i < count; ++i) {
        state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
        value = (value << 64n) | state;
      }
      return value | (1n << BigInt(count * 64 - 1));
    };

    const failures: string[] = [];
    const shapes: [number, number][] = [
      [44, 44],
      [45, 45],
      [100, 50],
      [300, 47],
      [257, 130],
      [50, 2],
      [120, 56],
      [90, 30],
    ];
    for (const [longer, shorter] of shapes) {
      const a = digits(longer, 1n);
      const b = digits(shorter, 2n);
      const r = digits(shorter, 3n) % b;
      const product = a * b;
      if (product !== b * a) failures.push(`${longer}x${shorter}: a * b !== b * a`);
      if (product / b !== a) failures.push(`${longer}x${shorter}: (a * b) / b !== a`);
      if (product % b !== 0n) failures.push(`${longer}x${shorter}: (a * b) % b !== 0`);
      if ((product + r) / b !== a) failures.push(`${longer}x${shorter}: (a * b + r) / b !== a`);
      if ((product + r) % b !== r) failures.push(`${longer}x${shorter}: (a * b + r) % b !== r`);
      if (-product / b !== -a) failures.push(`${longer}x${shorter}: -(a * b) / b !== -a`);
      // (a + 1) * b - 1 has the quotient a and the remainder b - 1.
      const below = product + b - 1n;
      if (below / b !== a || below % b !== b - 1n) failures.push(`${longer}x${shorter}: quotient below a multiple`);
    }
    expect(failures).toEqual([]);
  });
});
