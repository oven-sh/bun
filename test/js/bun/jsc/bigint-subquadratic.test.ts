import { describe, expect, test } from "bun:test";

// BigInt.prototype.toString, multiplication, and exponentiation in
// JavaScriptCore were O(n^2) in the digit count: toStringGeneric
// repeatedly divides by a one-digit chunk divisor, and the only
// multi-digit multiply was schoolbook. With Karatsuba multiplication,
// Burnikel-Ziegler division and a divide-and-conquer toString, they are
// now O(n^log2(3)). These tests cover correctness across the new
// algorithm thresholds and assert that large-BigInt decimal conversion
// scales sub-quadratically.

let seed = 0x2b992ddfa23249d6n;
function rand64() {
  seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
  return seed;
}
function randBig(words: number) {
  let r = 0n;
  for (let i = 0; i < words; i++) r = (r << 64n) | rand64();
  return r;
}

describe("BigInt sub-quadratic arithmetic", () => {
  test("decimal toString round-trips across algorithm thresholds", () => {
    // 32 64-bit words is the Karatsuba threshold, 64 is both the
    // Burnikel-Ziegler and the divide-and-conquer toString threshold.
    for (const words of [1, 2, 31, 32, 33, 63, 64, 65, 128, 500]) {
      for (let i = 0; i < 3; i++) {
        const b = randBig(words);
        expect(BigInt(b.toString())).toBe(b);
        expect((-b).toString()).toBe("-" + b.toString());
        expect(BigInt("0x" + b.toString(16))).toBe(b);
      }
    }

    // Long zero runs (exercise remainder == 0 inside the recursive division).
    for (const e of [1234, 5000, 20000]) {
      const zeros = Buffer.alloc(e, "0").toString();
      const nines = Buffer.alloc(e, "9").toString();
      expect((10n ** BigInt(e)).toString()).toBe("1" + zeros);
      expect((10n ** BigInt(e) - 1n).toString()).toBe(nines);
    }
  });

  test("Karatsuba multiplication is correct across the threshold", () => {
    for (const words of [20, 33, 64, 300]) {
      const a = randBig(words);
      const b = randBig(words);
      expect(a * b).toBe(b * a);
      expect((a + b) * (a + b)).toBe(a * a + 2n * a * b + b * b);
      const small = randBig(3);
      expect(a * small).toBe(small * a);
      expect((a * small) / small).toBe(a);
    }
  });

  test("large BigInt decimal conversion scales sub-quadratically", () => {
    // The quadratic path quadruples the time per doubling of the digit
    // count; Karatsuba-backed divide-and-conquer grows by about x3.0.
    // Comparing the two endpoints across three doublings gives a wide
    // separation (~60x quadratic vs ~20x Karatsuba) that a scheduler or
    // GC hiccup cannot bridge. Several independent attempts and a minimum
    // keep an occasional slow sample on the large side from inflating the
    // ratio; only a consistently slow small-side measurement could deflate
    // it, and the small side is measured over enough iterations for that
    // not to happen.
    const time = (b: bigint, iters: number) => {
      const t0 = performance.now();
      for (let i = 0; i < iters; i++) b.toString();
      return (performance.now() - t0) / iters;
    };

    const lo = 10n ** 12500n - 1n;
    const hi = 10n ** 100000n - 1n;
    lo.toString();
    hi.toString();

    // Noise only adds time, so the minimum over a few attempts is the
    // closest sample to the true per-call cost for each size.
    let tLo = Infinity;
    let tHi = Infinity;
    for (let attempt = 0; attempt < 4; attempt++) {
      tLo = Math.min(tLo, time(lo, 5));
      tHi = Math.min(tHi, time(hi, 1));
    }
    const ratio = tHi / tLo;

    // Three doublings: quadratic is 64x in the limit (58-62 in practice);
    // n^log2(3) is 27x (18-22 in practice).
    expect(ratio).toBeLessThan(42);
  });
});
