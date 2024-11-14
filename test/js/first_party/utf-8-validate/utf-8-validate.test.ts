import { expect, test } from "bun:test";
import isValidUTF8 from "utf-8-validate";

test("utf-8-validate", () => {
  expect(isValidUTF8(Buffer.from("😀"))).toBeTrue();
  expect(isValidUTF8(Buffer.from([0xff]))).toBeFalse();
});
