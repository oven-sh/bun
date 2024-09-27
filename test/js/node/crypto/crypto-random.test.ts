import { describe, expect, it } from "bun:test";
import { randomBytes, randomInt, randomFill, randomFillSync } from "crypto";

describe("randomBytes args validation", async() => {
  it("size should be > 0 and <= 2147483647", () => {
    expect(() => randomBytes(-1)).toThrow(RangeError);
    expect(() => randomBytes(2147483648)).toThrow(RangeError);

    const buffer = randomBytes(16);
    expect(buffer.length).toBe(16);
  });
});

describe("randomInt args validation", async () => {
  it("default min is 0 so max should be greater than 0", () => {
    expect(() => randomInt(-1)).toThrow(RangeError);
    expect(() => randomInt(0)).toThrow(RangeError);
  });
  it("max should be >= min", () => {
    expect(() => randomInt(1, 0)).toThrow(RangeError);
    expect(() => randomInt(10, 5)).toThrow(RangeError);
  });

  it("we allow negative numbers", () => {
    expect(() => randomInt(-2, -1)).not.toThrow(RangeError);
  });

  it("max/min should not be greater than Number.MAX_SAFE_INTEGER or less than Number.MIN_SAFE_INTEGER", () => {
    expect(() => randomInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("max - min should be <= 281474976710655", () => {
    expect(() => randomInt(-2, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it("accept large negative numbers", () => {
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER + 1)).not.toThrow(RangeError);
  });
});

describe("randomFillSync args validation", async() => {
  const buffer = Buffer.alloc(16);

  it("buffer should be a Buffer or array-like object", () => {
    expect(() => randomFillSync(0, 0, 0)).toThrow(TypeError);
    expect(() => randomFillSync("hello", 0, 0)).toThrow(TypeError);
    expect(() => randomFillSync(Buffer.alloc(16), 0, 0)).not.toThrow();
    expect(() => randomFillSync(new Uint32Array(4), 0, 0)).not.toThrow();
  });

  it("offset should be > 0 and <= 2147483647", () => {
    expect(() => randomFillSync(buffer, -1, 0)).toThrow(RangeError);
    expect(() => randomFillSync(buffer, 2147483648, 0)).toThrow(RangeError);
    expect(() => randomFillSync(buffer, buffer, 0)).toThrow(TypeError);
  });

  it("size should be > 0 and <= 2147483647", () => {
    expect(() => randomFillSync(buffer, 0, -1)).toThrow(RangeError);
    expect(() => randomFillSync(buffer, 0, 2147483648)).toThrow(RangeError);
    expect(() => randomFillSync(buffer, 0, buffer)).toThrow(TypeError);
  });

  it("offset/size should be within buffer range", () => {
    expect(() => randomFillSync(buffer, buffer.length + 1, 0)).toThrow();
    expect(() => randomFillSync(buffer, buffer.length, 1)).toThrow();
  });
});

describe("randomFill args validation", async() => {
  it("callback should be a function", () => {
    expect(() => randomFill(Buffer.alloc(16), 0, buffer.length, buffer)).toThrow();
  });

  it("callback only", () => {
    randomFill(Buffer.alloc(16), function(err, buffer) {
      expect(buffer).not.toEqual(Buffer.alloc(16));
    });
  });

  it("callback with offset only", () => {
    randomFill(Buffer.alloc(16), 0, function(err, buffer) {
      expect(buffer).not.toEqual(Buffer.alloc(16));
    });
  });
});
