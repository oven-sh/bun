import { isBigIntInRange } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// Regression test for JSC__isBigIntInInt64Range / JSC__isBigIntInUInt64Range.
// Previously the C++ implementation had swapped (min, max) parameter names AND
// used OR-short-circuit logic, causing the function to return true when the
// value was OUTSIDE the range and false when it was INSIDE.
// This affected MySQL BigInt parameter binding (all in-range values were
// rejected with ERR_OUT_OF_RANGE).

const I64_MIN = -9223372036854775808n;
const I64_MAX = 9223372036854775807n;
const U64_MAX = 18446744073709551615n;

describe("isBigIntInInt64Range (signed)", () => {
  test("100n is in [i64_min, i64_max]", () => {
    expect(isBigIntInRange(100n, I64_MIN, I64_MAX, false)).toBe(true);
  });

  test("0n is in [i64_min, i64_max]", () => {
    expect(isBigIntInRange(0n, I64_MIN, I64_MAX, false)).toBe(true);
  });

  test("-100n is in [i64_min, i64_max]", () => {
    expect(isBigIntInRange(-100n, I64_MIN, I64_MAX, false)).toBe(true);
  });

  test("i64_max boundary is in range", () => {
    expect(isBigIntInRange(I64_MAX, I64_MIN, I64_MAX, false)).toBe(true);
  });

  test("i64_min boundary is in range", () => {
    expect(isBigIntInRange(I64_MIN, I64_MIN, I64_MAX, false)).toBe(true);
  });

  test("i64_max + 1 is out of range", () => {
    expect(isBigIntInRange(I64_MAX + 1n, I64_MIN, I64_MAX, false)).toBe(false);
  });

  test("i64_min - 1 is out of range", () => {
    expect(isBigIntInRange(I64_MIN - 1n, I64_MIN, I64_MAX, false)).toBe(false);
  });

  test("very large positive bigint is out of range", () => {
    expect(isBigIntInRange(2n ** 128n, I64_MIN, I64_MAX, false)).toBe(false);
  });

  test("very large negative bigint is out of range", () => {
    expect(isBigIntInRange(-(2n ** 128n), I64_MIN, I64_MAX, false)).toBe(false);
  });

  test("narrow range [0, 100]", () => {
    expect(isBigIntInRange(50n, 0n, 100n, false)).toBe(true);
    expect(isBigIntInRange(0n, 0n, 100n, false)).toBe(true);
    expect(isBigIntInRange(100n, 0n, 100n, false)).toBe(true);
    expect(isBigIntInRange(-1n, 0n, 100n, false)).toBe(false);
    expect(isBigIntInRange(101n, 0n, 100n, false)).toBe(false);
  });
});

describe("isBigIntInUInt64Range (unsigned)", () => {
  test("100n is in [0, u64_max]", () => {
    expect(isBigIntInRange(100n, 0n, U64_MAX, true)).toBe(true);
  });

  test("0n is in [0, u64_max]", () => {
    expect(isBigIntInRange(0n, 0n, U64_MAX, true)).toBe(true);
  });

  test("u64_max boundary is in range", () => {
    expect(isBigIntInRange(U64_MAX, 0n, U64_MAX, true)).toBe(true);
  });

  test("u64_max + 1 is out of range", () => {
    expect(isBigIntInRange(U64_MAX + 1n, 0n, U64_MAX, true)).toBe(false);
  });

  test("-1n is out of [0, u64_max]", () => {
    expect(isBigIntInRange(-1n, 0n, U64_MAX, true)).toBe(false);
  });

  test("very large bigint is out of range", () => {
    expect(isBigIntInRange(2n ** 128n, 0n, U64_MAX, true)).toBe(false);
  });
});
