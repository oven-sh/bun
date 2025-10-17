// foo.test.ts
import { describe, it, beforeAll } from "bun:test";

describe("foo", () => {
  beforeAll(() => {
    console.log("-- foo beforeAll");
  });

  describe("bar", () => {
    beforeAll(() => {
      console.log("-- bar beforeAll");
    });
    it("bar.1", () => {
      console.log("bar.1");
    });
  });

  describe("baz", () => {
    beforeAll(() => {
      console.log("-- baz beforeAll");
    });
    it("baz.1", () => {
      console.log("baz.1");
    });
  });
});
