import { describe, test, expect, beforeAll } from "@jest/globals";

describe("Outer describe", () => {
  beforeAll(() => {
    console.log("Running beforeAll in Outer describe");
  });

  describe("Middle describe", () => {
    beforeAll(() => {
      console.log("Running beforeAll in Middle describe");
    });

    test("middle is middle", () => {
      expect("middle").toBe("middle");
    });

    describe("Inner describe", () => {
      beforeAll(() => {
        console.log("Running beforeAll in Inner describe");
      });

      test("true is true", () => {
        expect(true).toBe(true);
      });

      test("false is false", () => {
        expect(false).toBe(false);
      });
    });
  });
});
