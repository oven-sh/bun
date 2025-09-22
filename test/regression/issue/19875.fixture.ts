import { describe, it, expect } from "bun:test";

describe.only("only", () => {
  describe.todo("todo", () => {
    it("fail", () => {
      expect(2).toBe(3);
    });
  });
});
