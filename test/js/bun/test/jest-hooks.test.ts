import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

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

  describe("beforeEach, afterEach with test.todo()", () => {
    let beforeEachCalled = 0;
    let afterEachCalled = 0;

    beforeEach(() => {
      beforeEachCalled++;
    });

    afterEach(() => {
      afterEachCalled++;
    });

    it.todo("TODO test");

    it("should have not called beforeEach or afterEach for test.todo", () => {
      expect(beforeEachCalled).toEqual(1); // Called once just before this test
      expect(afterEachCalled).toEqual(0);
    });

    it("should have called afterEach for previous test", () => {
      expect(beforeEachCalled).toEqual(2); // Called once just before this test
      expect(afterEachCalled).toEqual(1);
    });
  });
});

describe("registered inside AsyncLocalStorage.run()", () => {
  const storage = new AsyncLocalStorage<string>();
  const seen: (string | undefined)[] = [];
  storage.run("store", () => {
    beforeAll(() => void seen.push(storage.getStore()));
    beforeEach(() => void seen.push(storage.getStore()));

    it("a callback without a parameter isn't waited for as one that takes done", (...args) => {
      expect(args).toEqual([]);
      expect([...seen, storage.getStore()]).toEqual(["store", "store", "store"]);
    });

    it("a callback with a parameter is given done", done => {
      expect(storage.getStore()).toBe("store");
      done();
    });

    it.each([[1, 2]])("so is one with a parameter past the row's values", (a, b, done) => {
      expect([a, b, storage.getStore()]).toEqual([1, 2, "store"]);
      done();
    });
  });
});

describe("afterEach runs before any other pending callback", () => {
  let where = "";
  let fired = Promise.withResolvers<void>();
  const seen: string[] = [];
  const callback = () => {
    seen.push(where);
    fired.resolve();
  };
  const untilTimersAreDue = () => {
    const start = performance.now();
    while (performance.now() - start < 2);
  };

  afterEach(async () => {
    where = "afterEach";
    await fired.promise;
    fired = Promise.withResolvers<void>();
  });

  it("runs before a due timer when setImmediate resumed the test", async () => {
    await new Promise(resolve => setImmediate(resolve));
    setTimeout(callback, 0);
    untilTimersAreDue();
    where = "after the test";
  });

  it("runs before a due timer when setImmediate called done()", done => {
    setImmediate(() => {
      setTimeout(callback, 0);
      untilTimersAreDue();
      where = "after the test";
      done();
    });
  });

  it("runs before the next due timer when a timer resumed the test", async () => {
    const first = new Promise(resolve => setTimeout(resolve, 1));
    setTimeout(callback, 1);
    untilTimersAreDue();
    await first;
    where = "after the test";
  });

  it("runs before the next immediate when setImmediate resumed the test", async () => {
    const first = new Promise(resolve => setImmediate(resolve));
    setImmediate(callback);
    await first;
    where = "after the test";
  });

  it("every callback fired during afterEach", () => {
    fired.resolve();
    expect(seen).toEqual(["afterEach", "afterEach", "afterEach", "afterEach"]);
  });
});
