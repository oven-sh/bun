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
    const customTimestamp = 1625097600000; // 2021-07-01T00:00:00.000Z
    const uuid = Bun.randomUUIDv7("hex", customTimestamp);
    expect(uuid).toStartWith("017a5f5d-");
    expect(Bun.randomUUIDv7()).not.toStartWith("017a5f5d-");
    expect(Bun.randomUUIDv7("hex", new Date(customTimestamp))).toStartWith("017a5f5d-");
    console.log({ uuid });
    console.log({ uuid: Bun.randomUUIDv7("hex", new Date(customTimestamp)) });
    console.log({ uuid: Bun.randomUUIDv7("hex", new Date(customTimestamp)) });
  });

  test("monotonic", () => {
    const customTimestamp = 1625097600000; // 2021-07-01T00:00:00.000Z
    let input = Array.from({ length: 100 }, () => Bun.randomUUIDv7("hex", customTimestamp));
    let sorted = input.slice().sort();

    // If we get unlucky, it will rollover.
    if (!Bun.deepEquals(sorted, input)) {
      input = Array.from({ length: 100 }, () => Bun.randomUUIDv7("hex", customTimestamp));
      sorted = input.slice().sort();
    }

    expect(sorted).toEqual(input);
  });
});
