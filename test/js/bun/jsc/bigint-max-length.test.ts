import { describe, expect, test } from "bun:test";

// Coverage for oven-sh/WebKit#484 (issue #39964). JSC capped a BigInt at
// 1 << 20 bits, so workloads that run on Node.js (V8 allows 1 << 30 bits)
// failed with "RangeError: Out of memory: BigInt generated from this
// operation is too big". The cap is 1 << 30 bits now.

describe.concurrent("BigInt maxLengthBits is 1 << 30", () => {
  test("a left shift can exceed 2^20 bits", () => {
    // One bit past the old cap.
    const x = 1n << 1048576n;
    expect(x.toString(2).length).toBe(1048577);
    expect(x >> 1048576n).toBe(1n);
  });

  test("a product can exceed 2^20 bits", () => {
    const a = (1n << 524300n) | 1n;
    const b = a * a;
    expect(b >> 1048600n).toBe(1n);
    expect(b & 1n).toBe(1n);
  });

  test("addition at the old cap no longer overflows", () => {
    const allOnes = (1n << 1048576n) - 1n;
    expect(allOnes + 1n).toBe(1n << 1048576n);
  });

  test("2^n exponentiation works past the old cap", () => {
    expect((2n ** 2000000n) >> 2000000n).toBe(1n);
  });

  test("asUintN widths past the old cap work", () => {
    expect(BigInt.asUintN(2000000, -1n).toString(2).length).toBe(2000000);
  });

  test("operations past 2^30 bits still throw RangeError", () => {
    // The exponent check rejects 2^30 before any allocation.
    expect(() => 2n ** 1073741824n).toThrow(RangeError);
    expect(() => 2n ** 4294967296n).toThrow(RangeError);
  });
});
