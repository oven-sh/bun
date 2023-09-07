import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";

let hooks_run: string[] = [];

beforeAll(() => hooks_run.push("global beforeAll"));
beforeEach(() => hooks_run.push("global beforeEach"));
afterAll(() => hooks_run.push("global afterAll"));
afterEach(() => hooks_run.push("global afterEach"));

describe("describe scope", () => {
  beforeAll(() => hooks_run.push("describe beforeAll"));
  beforeEach(() => hooks_run.push("describe beforeEach"));
  afterAll(() => hooks_run.push("describe afterAll"));
  afterEach(() => hooks_run.push("describe afterEach"));

  it("should run after beforeAll/beforeEach in the correct order", () => {
    expect(hooks_run).toEqual(["global beforeAll", "describe beforeAll", "global beforeEach", "describe beforeEach"]);
  });

  it("should run after afterEach/afterAll in the correct order", () => {
    expect(hooks_run).toEqual([
      "global beforeAll",
      "describe beforeAll",
      "global beforeEach",
      "describe beforeEach",
      "describe afterEach",
      "global afterEach",
      "global beforeEach",
      "describe beforeEach",
    ]);
  });
});

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

  describe("test async hooks", async () => {
    let beforeAllCalled = 0;
    let beforeEachCalled = 0;
    let afterAllCalled = 0;
    let afterEachCalled = 0;

    beforeAll(async () => {
      beforeAllCalled += await 1;
    });

    beforeEach(async () => {
      beforeEachCalled += await 1;
    });

    afterAll(async () => {
      afterAllCalled += await 1;
    });

    afterEach(async () => {
      afterEachCalled += await 1;
    });

    it("should run after beforeAll()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(1);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(0);
    });

    it("should run after beforeEach()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(2);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(1);
    });
  });

  describe("test done callback in hooks", () => {
    let beforeAllCalled = 0;
    let beforeEachCalled = 0;
    let afterAllCalled = 0;
    let afterEachCalled = 0;

    beforeAll(done => {
      setImmediate(() => {
        beforeAllCalled++;
        done();
      });
    });

    beforeEach(done => {
      setImmediate(() => {
        beforeEachCalled++;
        done();
      });
    });

    afterAll(done => {
      setImmediate(() => {
        afterAllCalled++;
        done();
      });
    });

    afterEach(done => {
      setImmediate(() => {
        afterEachCalled++;
        done();
      });
    });

    it("should run after beforeAll()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(1);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(0);
    });

    it("should run after beforeEach()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(2);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(1);
    });
  });

  describe("test async hooks with done()", () => {
    let beforeAllCalled = 0;
    let beforeEachCalled = 0;
    let afterAllCalled = 0;
    let afterEachCalled = 0;

    beforeAll(async done => {
      beforeAllCalled += await 1;
      setTimeout(done, 1);
    });

    beforeEach(async done => {
      beforeEachCalled += await 1;
      setTimeout(done, 1);
    });

    afterAll(async done => {
      afterAllCalled += await 1;
      setTimeout(done, 1);
    });

    afterEach(async done => {
      afterEachCalled += await 1;
      setTimeout(done, 1);
    });

    it("should run after beforeAll()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(1);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(0);
    });

    it("should run after beforeEach()", () => {
      expect(beforeAllCalled).toBe(1);
      expect(beforeEachCalled).toBe(2);
      expect(afterAllCalled).toBe(0);
      expect(afterEachCalled).toBe(1);
    });
  });
});
