// foo.test.ts
import { beforeAll, describe, it } from "bun:test";

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
