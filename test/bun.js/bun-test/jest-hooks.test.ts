import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

describe("test jest hooks in bun-test", () => {
  describe("test beforeAll hook", () => {
    let animal = "tiger";

    beforeAll(() => {
      animal = "lion";
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });

  describe("test beforeEach hook", () => {
    let animal = "tiger";

    beforeEach(() => {
      animal = "lion";
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
      animal = "dog";
    });

    it("string should be re-set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });

  describe("test afterEach hook", () => {
    let animal = "tiger";

    afterEach(() => {
      animal = "lion";
    });

    it("string should not be set by hook", () => {
      expect(animal).toEqual("tiger");
      animal = "dog";
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });

  describe("test afterAll hook", () => {
    let animal = "tiger";

    describe("test afterAll hook", () => {
      afterAll(() => {
        animal = "lion";
      });

      it("string should not be set by hook", () => {
        expect(animal).toEqual("tiger");
        animal = "dog";
      });
    });

    it("string should be set by hook", () => {
      expect(animal).toEqual("lion");
    });
  });
});
