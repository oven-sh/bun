import { test, expect } from "bun:test";
import { isUtf8 } from "node:buffer";
import isValidUTF8 from "utf-8-validate";

test("utf-8-validate", () => {
  expect(isValidUTF8).toBe(isUtf8);
  expect(isValidUTF8(Buffer.from("😀"))).toBeTrue()
  expect(isValidUTF8(Buffer.from([0xff]))).toBeFalse();
});
