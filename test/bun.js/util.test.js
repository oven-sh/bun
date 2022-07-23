import { expect, describe, it } from "bun:test";
import { TextEncoder } from "util";


describe("util", () => {
  describe("TextEncoder", () => {
    // test/bun.js/text-encoder.test.js covers test cases for TextEncoder
    // here we test only if we use the same via util.TextEncoder
    it("is same as global TextEncoder", () => {
      expect(TextEncoder === globalThis.TextEncoder).toBe(true);
    });
  });
});
