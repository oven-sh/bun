import { describe, expect, test } from "bun:test";

// JSBigInt::parseInt historically routed every radix through a loop that
// calls multiplyAdd over the full-length digit vector for each small group
// of characters, which is O(n^2) in the number of characters. For
// power-of-two radixes (0b/0o/0x prefixes) the parse is a straight bit-pack
// and should be O(n), matching toStringBasePowerOfTwo in the other direction.

// Buffer.alloc semantics: `len` is the OUTPUT length in bytes; `fill` is tiled
// into it. Not `fill.repeat(len)`.
const fill = (len: number, pattern: string) => Buffer.alloc(len, pattern).toString();

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
    roundtrip("0x", 16, fill(16, "f")); // exactly one 64-bit word
    roundtrip("0x", 16, fill(17, "f")); // one word + 4 bits
    roundtrip("0x", 16, "1" + fill(100, "0"));
    roundtrip("0x", 16, fill(1000, "f"));
    roundtrip("0x", 16, fill(3200, "123456789abcdef0")); // 200 full words, mixed digits
    // Non-16-aligned lengths to hit partial high digits.
    for (let n = 1; n <= 40; n++) roundtrip("0x", 16, fill(n, "a"));
  });

  test("binary correctness", () => {
    roundtrip("0b", 2, "1");
    roundtrip("0b", 2, fill(63, "1"));
    roundtrip("0b", 2, fill(64, "1"));
    roundtrip("0b", 2, fill(65, "1"));
    roundtrip("0b", 2, fill(1000, "1"));
    roundtrip("0b", 2, fill(1000, "10"));
    for (let n = 1; n <= 130; n++) roundtrip("0b", 2, fill(n, "1"));
  });

  test("octal correctness (3 bits/char, spans digit boundaries)", () => {
    roundtrip("0o", 8, "7");
    roundtrip("0o", 8, fill(21, "7"));
    roundtrip("0o", 8, fill(22, "7"));
    roundtrip("0o", 8, fill(23, "7"));
    roundtrip("0o", 8, fill(1400, "1234567"));
    roundtrip("0o", 8, fill(1000, "7"));
    // The msb of the leading char can land in the low bits of the next
    // 64-bit word, leaving that word zero. Exercise every alignment.
    for (let n = 1; n <= 70; n++) roundtrip("0o", 8, fill(n, "1"));
    for (let n = 1; n <= 70; n++) roundtrip("0o", 8, fill(n, "7"));
  });

  test("cross-radix agreement on large values", () => {
    const hex = fill(4096, "f");
    const v16 = BigInt("0x" + hex);
    const v2 = BigInt("0b" + fill(4096 * 4, "1"));
    expect(v16 === v2).toBe(true);
    expect(v16.toString(16)).toBe(hex);
    expect(v16).toBe((1n << BigInt(4096 * 4)) - 1n);
  });

  test("leading zeros, whitespace, and 16-bit string storage", () => {
    expect(BigInt("0x" + fill(1000, "0") + "ff")).toBe(255n);
    expect(BigInt("  0x" + fill(100, "f") + "  ")).toBe(BigInt("0x" + fill(100, "f")));
    expect(BigInt("0x" + fill(1000, "0"))).toBe(0n);
    // Leading zeros pushing the raw character count past the 2^20-bit cap must
    // still parse: the length check runs after zeros are stripped.
    expect(BigInt("0x" + fill(300_000, "0") + "ff")).toBe(255n);
    // U+2003 EM SPACE is a legal StrWhiteSpaceChar and forces 16-bit string
    // storage, so this routes through the UChar instantiation of parseInt.
    const body = fill(1000, "f");
    expect(BigInt("\u2003" + "0x" + body + "\u2003")).toBe(BigInt("0x" + body));
  });

  test("maxLength boundary (2^20 bits)", () => {
    const atLimit = BigInt("0x" + fill(262_144, "f"));
    expect(atLimit.toString(16).length).toBe(262_144);
    expect(() => BigInt("0x" + fill(262_145, "f"))).toThrow(RangeError);
  });

  test("invalid characters still throw SyntaxError", () => {
    expect(() => BigInt("0x" + fill(1000, "f") + "g")).toThrow(SyntaxError);
    expect(() => BigInt("0b" + fill(1000, "1") + "2")).toThrow(SyntaxError);
    expect(() => BigInt("0o" + fill(1000, "7") + "8")).toThrow(SyntaxError);
    expect(() => BigInt("0xg" + fill(1000, "f"))).toThrow(SyntaxError);
  });

  test("parse is linear, not quadratic", () => {
    // JSC caps BigInt at 2^20 bits (262144 hex chars / 349525 octal chars).
    // Use 250000 chars: the O(n^2) path takes ~570ms hex and ~300ms octal on a
    // release build (seconds under debug), while the O(n) path stays under
    // ~10ms even under debug+ASAN.
    const n = 250_000;
    const hex = "0x" + fill(n, "f");
    const oct = "0o" + fill(n, "7");

    const t0 = performance.now();
    const vHex = BigInt(hex);
    const hexMs = performance.now() - t0;

    const t1 = performance.now();
    const vOct = BigInt(oct);
    const octMs = performance.now() - t1;

    expect(vHex.toString(16)).toBe(fill(n, "f"));
    expect(vOct.toString(8)).toBe(fill(n, "7"));

    expect(hexMs).toBeLessThan(250);
    expect(octMs).toBeLessThan(250);
  });
});
