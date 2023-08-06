// const { test, it, expect, describe } = require("@jest/globals");
import { it, describe, expect } from "@jest/globals";

describe("jest-each", () => {
  describe("normal test", () => {
    it("Still works", () => {
      expect(1).toBe(1);
    });

    it("Still works with callback", done => {
      expect(done).toBeDefined();
      done();
    });

    it("Doesn't pass extra args", (done, unused, useless) => {
      expect(done).toBeDefined();
      expect(unused).toBeUndefined();
      expect(useless).toBeUndefined();
      done();
    });
  });
});
