import { describe, expect, it } from "bun:test";
import { randomInt } from "crypto";

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
