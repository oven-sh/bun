import { it, expect } from "bun:test";
import { randomInt } from "crypto";

it("randomInt args validation", async () => {
  expect(() => randomInt(-1)).toThrow(RangeError);
  expect(() => randomInt(0)).toThrow(RangeError);
  expect(() => randomInt(1, 0)).toThrow(RangeError);
  expect(() => randomInt(10, 5)).toThrow(RangeError);
  expect(() => randomInt(-2, -1)).not.toThrow(RangeError);
  expect(() => randomInt(-2, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  expect(() => randomInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  expect(() => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  expect(() => randomInt(-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER + 1)).not.toThrow(RangeError);
});
