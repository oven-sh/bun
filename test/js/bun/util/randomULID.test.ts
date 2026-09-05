import { randomULID } from "bun";
import { describe, expect, test } from "bun:test";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function timestampOf(ulid: string): number {
  let timestamp = 0;
  for (const char of ulid.slice(0, 10)) {
    timestamp = timestamp * 32 + CROCKFORD_BASE32.indexOf(char);
  }
  return timestamp;
}

describe("randomULID", () => {
  test("returns a canonical ULID from the Bun namespace and bun module", () => {
    for (const ulid of [Bun.randomULID(), randomULID()]) {
      expect(ulid).toBeTypeOf("string");
      expect(ulid).toHaveLength(26);
      expect(ulid).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    }
  });

  test.each([
    [0, "0000000000"],
    [1, "0000000001"],
    [31, "000000000Z"],
    [32, "0000000010"],
    [1_469_918_176_385, "01ARYZ6S41"],
    [2 ** 48 - 2, "7ZZZZZZZZY"],
    [2 ** 48 - 1, "7ZZZZZZZZZ"],
  ])("encodes timestamp %d", (timestamp, prefix) => {
    const ulid = Bun.randomULID(timestamp);
    expect(ulid.slice(0, 10)).toBe(prefix);
    expect(timestampOf(ulid)).toBe(timestamp);
  });

  test("accepts Date timestamps", () => {
    expect(timestampOf(Bun.randomULID(new Date(0)))).toBe(0);
    expect(timestampOf(Bun.randomULID(new Date(2 ** 48 - 1)))).toBe(2 ** 48 - 1);
  });

  test("encodes the current timestamp by default", () => {
    const before = Date.now();
    const timestamp = timestampOf(Bun.randomULID());
    const after = Date.now();
    expect(timestamp).toBeGreaterThanOrEqual(before - 1_000);
    expect(timestamp).toBeLessThanOrEqual(after + 1_000);
  });

  test("sorts across different timestamps", () => {
    const timestamps = [0, 1, 31, 32, 1_469_918_176_385, 2 ** 48 - 2, 2 ** 48 - 1];
    const ulids = timestamps.map(timestamp => Bun.randomULID(timestamp));
    expect(ulids.toSorted()).toEqual(ulids);
  });

  test("generates unique randomness within one millisecond", () => {
    const ulids = Array.from({ length: 1_000 }, () => Bun.randomULID(1_469_918_176_385));
    expect(new Set(ulids).size).toBe(ulids.length);
  });

  test.each([
    ["negative", -1],
    ["NaN", NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["2**48", 2 ** 48],
    ["Number.MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["negative Date", new Date(-1)],
    ["out-of-range Date", new Date(2 ** 48)],
    ["Invalid Date", new Date(NaN)],
  ])("rejects %s", (_, timestamp) => {
    expect(() => Bun.randomULID(timestamp)).toThrow(RangeError);
  });

  test("rejects fractional and non-numeric timestamps", () => {
    expect(() => Bun.randomULID(1.5)).toThrow(TypeError);
    expect(() => Bun.randomULID(null as any)).toThrow(TypeError);
    expect(() => Bun.randomULID("0" as any)).toThrow(TypeError);
  });
});
