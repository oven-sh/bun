import { describe, expect, test } from "bun:test";

describe("Buffer.compare bounds validation", () => {
  // Ensure out-of-range end offsets throw ERR_OUT_OF_RANGE, matching Node.js behavior
  test("targetEnd exceeding target length throws ERR_OUT_OF_RANGE", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    expect(() => a.compare(b, 0, 100)).toThrow();
  });

  test("sourceEnd exceeding source length throws ERR_OUT_OF_RANGE", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    expect(() => a.compare(b, 0, 10, 0, 100)).toThrow();
  });

  // When start > end (inverted/zero-length range), Node.js returns early without
  // checking start against buffer length. This matches Node.js semantics.
  test("targetStart exceeding target length with default targetEnd returns 1 (zero-length target)", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // targetStart=100, targetEnd=10 (default), targetStart >= targetEnd → return 1
    expect(a.compare(b, 100)).toBe(1);
  });

  test("sourceStart exceeding source length with default sourceEnd returns -1 (zero-length source)", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // sourceStart=100, sourceEnd=10 (default), sourceStart >= sourceEnd → return -1
    expect(a.compare(b, 0, 10, 100)).toBe(-1);
  });

  // Inverted ranges where both start and end exceed buffer length must throw
  // because end is validated against buffer length BEFORE the start>=end early return
  test("inverted target range with both values out of bounds throws (targetEnd > buffer length)", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // targetStart=100, targetEnd=50 — targetEnd(50) > b.length(10) → throws
    expect(() => a.compare(b, 100, 50)).toThrow();
  });

  test("inverted source range with both values out of bounds throws (sourceEnd > buffer length)", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // sourceStart=100, sourceEnd=50 — sourceEnd(50) > a.length(10) → throws
    expect(() => a.compare(b, 0, 10, 100, 50)).toThrow();
  });

  // Mixed: one side OOB end, should throw
  test("mixed OOB: targetEnd and sourceEnd both exceed buffer lengths throws", () => {
    const small = Buffer.alloc(10, 0x41);
    const oracle = Buffer.alloc(10, 0x42);
    // targetEnd=50 > oracle.length(10) → throws before anything else
    expect(() => small.compare(oracle, 100, 50, 0, 40)).toThrow();
  });

  // After the fix, OOB sourceEnd is caught even when sourceStart < sourceEnd
  test("sourceEnd past buffer with valid sourceStart throws", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // sourceStart=0, sourceEnd=40 > a.length(10) → throws
    expect(() => a.compare(b, 0, 10, 0, 40)).toThrow();
  });

  // Verify that valid ranges still work correctly
  test("valid sub-range comparison works", () => {
    const a = Buffer.from([1, 2, 3, 4, 5]);
    const b = Buffer.from([3, 4, 5, 6, 7]);
    // Compare a[2..5] vs b[0..3] -> [3,4,5] vs [3,4,5] -> 0
    expect(a.compare(b, 0, 3, 2)).toBe(0);
  });

  test("zero-length ranges return correct values", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // sourceStart == sourceEnd -> zero-length source, non-zero target -> -1
    expect(a.compare(b, 0, 5, 3, 3)).toBe(-1);
    // targetStart == targetEnd -> zero-length target, non-zero source -> 1
    expect(a.compare(b, 3, 3, 0, 5)).toBe(1);
    // Both zero-length -> 0
    expect(a.compare(b, 3, 3, 3, 3)).toBe(0);
  });

  test("start equal to buffer length with matching end is zero-length", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // targetStart=10, targetEnd=10 -> zero-length target -> 1
    expect(a.compare(b, 10, 10, 0, 5)).toBe(1);
    // sourceStart=10, sourceEnd=10 -> zero-length source -> -1
    expect(a.compare(b, 0, 5, 10, 10)).toBe(-1);
  });

  test("end values at exact buffer length are valid", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    // targetEnd=10 (== b.length) and sourceEnd=10 (== a.length) should be fine
    expect(a.compare(b, 0, 10, 0, 10)).toBe(-1);
  });

  test("end values one past buffer length throw", () => {
    const a = Buffer.alloc(10, 0x61);
    const b = Buffer.alloc(10, 0x62);
    expect(() => a.compare(b, 0, 11, 0, 10)).toThrow();
    expect(() => a.compare(b, 0, 10, 0, 11)).toThrow();
  });
});
