import { test, expect, describe } from "bun:test";

// JSBigInt::parseInt historically routed every radix through a loop that
// calls multiplyAdd over the full-length digit vector for each small group
// of characters, which is O(n^2) in the number of characters. For
// power-of-two radixes (0b/0o/0x prefixes) the parse is a straight bit-pack
// and should be O(n), matching toStringBasePowerOfTwo in the other direction.

const rep = (c: string, n: number) => Buffer.alloc(n, c).toString();

describe("BigInt string parse, power-of-two radix", () => {
  const roundtrip = (prefix: string, radix: number, body: string) => {
    const v = BigInt(prefix + body);
    expect(v.toString(radix)).toBe(body.toLowerCase().replace(/^0+(?=.)/, ""));
    return v;
  };

  test("hex correctness", () => {
    roundtrip("0x", 16, "1");
    roundtrip("0x", 16, "F");
    roundtrip("0x", 16, "DeadBeef");
    roundtrip("0x", 16, rep("ff", 8));
    roundtrip("0x", 16, rep("ff", 9));
    roundtrip("0x", 16, "1" + rep("0", 100));
    roundtrip("0x", 16, rep("f", 1000));
    roundtrip("0x", 16, rep("123456789abcdef0", 200));
    // Non-16-aligned lengths to hit partial high digits.
    for (let n = 1; n <= 40; n++) roundtrip("0x", 16, rep("a", n));
  });

  test("binary correctness", () => {
    roundtrip("0b", 2, "1");
    roundtrip("0b", 2, rep("1", 63));
    roundtrip("0b", 2, rep("1", 64));
    roundtrip("0b", 2, rep("1", 65));
    roundtrip("0b", 2, rep("1", 1000));
    roundtrip("0b", 2, rep("10", 500));
    for (let n = 1; n <= 130; n++) roundtrip("0b", 2, rep("1", n));
  });

  test("octal correctness (3 bits/char, spans digit boundaries)", () => {
    roundtrip("0o", 8, "7");
    roundtrip("0o", 8, rep("7", 21));
    roundtrip("0o", 8, rep("7", 22));
    roundtrip("0o", 8, rep("7", 23));
    roundtrip("0o", 8, rep("1234567", 200));
    roundtrip("0o", 8, rep("7", 1000));
    // The msb of the leading char can land in the low bits of the next
    // 64-bit word, leaving that word zero. Exercise every alignment.
    for (let n = 1; n <= 70; n++) roundtrip("0o", 8, rep("1", n));
    for (let n = 1; n <= 70; n++) roundtrip("0o", 8, rep("7", n));
  });

  test("cross-radix agreement on large values", () => {
    const hex = rep("f", 4096);
    const v16 = BigInt("0x" + hex);
    const v2 = BigInt("0b" + rep("1", 4096 * 4));
    expect(v16 === v2).toBe(true);
    expect(v16.toString(16)).toBe(hex);
    expect(v16).toBe((1n << BigInt(4096 * 4)) - 1n);
  });

  test("leading zeros and whitespace still handled", () => {
    expect(BigInt("0x" + rep("0", 1000) + "ff")).toBe(255n);
    expect(BigInt("  0x" + rep("f", 100) + "  ")).toBe(BigInt("0x" + rep("f", 100)));
    expect(BigInt("0x" + rep("0", 1000))).toBe(0n);
  });

  test("invalid characters still throw SyntaxError", () => {
    expect(() => BigInt("0x" + rep("f", 1000) + "g")).toThrow(SyntaxError);
    expect(() => BigInt("0b" + rep("1", 1000) + "2")).toThrow(SyntaxError);
    expect(() => BigInt("0o" + rep("7", 1000) + "8")).toThrow(SyntaxError);
    expect(() => BigInt("0xg" + rep("f", 1000))).toThrow(SyntaxError);
  });

  test("parse is linear, not quadratic", () => {
    // JSC caps BigInt at 2^20 bits (262144 hex chars). Use 250000, large
    // enough that the O(n^2) path is unmistakably slow on any build while the
    // O(n) path stays well under the threshold even under debug+ASAN.
    // Quadratic: ~570ms release, seconds under debug. Linear: a few ms
    // release, tens of ms debug.
    const n = 250_000;
    const s = "0x" + rep("f", n);
    const t0 = performance.now();
    const v = BigInt(s);
    const parseMs = performance.now() - t0;

    // Correctness check on the same value.
    expect(v.toString(16)).toBe(rep("f", n));

    expect(parseMs).toBeLessThan(250);
  });
});
