import { describe, expect, test } from "bun:test";

describe("randomUUIDv7", () => {
  test("basic", () => {
    expect(Bun.randomUUIDv7()).toBeTypeOf("string");

    // "0192ce01-8345-7e10-36a8-2f220ca9e4c7"
    expect(Bun.randomUUIDv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Version number:
    expect(Bun.randomUUIDv7()["0192ce01-8345-".length]).toBe("7");
  });

  test("timestamp", () => {
    const now = Date.now();
    const uuid = Bun.randomUUIDv7(undefined, now).replaceAll("-", "");
    const timestampOriginal = parseInt(uuid.slice(0, 12).toString(), 16);

    // On Windows, timers drift by about 16ms. Let's 2x that.
    const timestamp = Math.max(timestampOriginal, now) - Math.min(timestampOriginal, now);
    expect(timestamp).toBeLessThanOrEqual(32);
  });

  test("base64 format", () => {
    const uuid = Bun.randomUUIDv7("base64");
    expect(uuid).toMatch(/^[0-9a-zA-Z+/=]+$/);
  });

  test("buffer output encoding", () => {
    const uuid = Bun.randomUUIDv7("buffer");
    expect(uuid).toBeInstanceOf(Buffer);
    expect(uuid.byteLength).toBe(16);
    console.log(uuid.toString("hex"));
  });

  test("custom timestamp", () => {
    // Use a far-future timestamp so it is ahead of the Date.now() calls above;
    // the implementation never moves the emitted timestamp backward.
    const customTimestamp = 4099680000000; // 2099-11-30T00:00:00.000Z
    const uuid = Bun.randomUUIDv7("hex", customTimestamp);
    expect(uuid).toStartWith("03ba87f8-5800-");
    expect(Bun.randomUUIDv7("hex", new Date(customTimestamp + 1))).toStartWith("03ba87f8-5801-");
  });

  test("monotonic", () => {
    const customTimestamp = 1625097600000; // 2021-07-01T00:00:00.000Z
    const input = Array.from({ length: 100 }, () => Bun.randomUUIDv7("hex", customTimestamp));
    const sorted = input.slice().sort();
    expect(sorted).toEqual(input);
  });

  test("older explicit timestamps do not move UUIDs backward", () => {
    const latest = Bun.randomUUIDv7("hex", 4_500_000_000_000);
    const stale = Bun.randomUUIDv7("hex", 1);
    expect(stale > latest).toBe(true);
    expect(stale.slice(0, 13)).toBe(latest.slice(0, 13));
  });

  test("monotonic across 12-bit counter rollover", () => {
    // 10000 UUIDs at a pinned millisecond forces at least two rollovers of the
    // 12-bit rand_a counter. The sequence must still be strictly increasing.
    const ts = 1750000000000;
    let prev = "";
    let firstBreak = -1;
    for (let i = 0; i < 10000; i++) {
      const u = Bun.randomUUIDv7("hex", ts);
      if (i > 0 && u <= prev && firstBreak === -1) firstBreak = i;
      prev = u;
    }
    expect(firstBreak).toBe(-1);
  });

  test("counter is seeded pseudo-randomly on a new millisecond", () => {
    // Sample the first UUID of several fresh milliseconds. The 12-bit rand_a
    // field (bytes 6-7, low 12 bits) should not be the same constant every time.
    const seen = new Set<number>();
    let ts = 5_000_000_000_000; // ahead of every other timestamp used in this file
    for (let i = 0; i < 64; i++) {
      ts += 1_000_000; // jump far ahead of any rollover-bumped timestamp
      const buf = Bun.randomUUIDv7("buffer", ts);
      seen.add(((buf[6] & 0x0f) << 8) | buf[7]);
    }
    // With an 11-bit random seed, 64 independent draws collapsing to one value
    // has probability 2^-693. A fixed reset (the old behavior) yields size 1.
    expect(seen.size).toBeGreaterThan(1);
  });
});
