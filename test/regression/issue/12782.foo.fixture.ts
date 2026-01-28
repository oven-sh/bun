import { describe, it } from "bun:test";

describe("foo", () => {
  it("should not run", () => {
    console.log("foo: this test should not run");
  });
  describe("inner describe", () => {
    it("should not run", () => {
      console.log("inner foo: this test should not run");
    });
  });
});
