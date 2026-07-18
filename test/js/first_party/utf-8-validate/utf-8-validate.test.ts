import { expect, test } from "bun:test";
import isValidUTF8 from "utf-8-validate";

test("utf-8-validate", () => {
  expect(isValidUTF8(Buffer.from("😀"))).toBeTrue();
  expect(isValidUTF8(Buffer.from([0xff]))).toBeFalse();
});

test("utf-8-validate is not a constructor", () => {
  expect(() => Reflect.construct(isValidUTF8, [Buffer.from("x")])).toThrow(TypeError);
  expect(Bun.inspect(isValidUTF8)).toBe("[Function: utf8Validate]");
});
