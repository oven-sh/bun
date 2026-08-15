import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "bun:test";
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

// The runner adds its own entry to the async context while a hook or test runs; what the
// callback itself does to the context has to stay in effect afterwards, as it always has.
describe("what a hook does to the AsyncLocalStorage context stays in effect for the tests that follow", () => {
  const storage = new AsyncLocalStorage<string>();
  afterAll(() => storage.disable());

  // First, while no store has been entered yet: a hook registered while a store is active runs
  // under that store instead (last describe in this file). The runner's own entry is in the
  // context when these hooks are registered, and must not count as such a store.
  describe("entered in hooks registered inside a test", () => {
    let storeWhenOnTestFinishedRan: string | undefined;

    it("registers them", () => {
      afterEach(() => {
        storage.enterWith("from the afterEach");
      });
      // Runs after the afterEach hooks, including the file's.
      onTestFinished(() => {
        storeWhenOnTestFinishedRan = storage.getStore();
        storage.enterWith("from the onTestFinished");
      });
    });

    it("each one's store is in effect for what follows it", () => {
      expect(storeWhenOnTestFinishedRan).toBe("from the afterEach");
      expect(storage.getStore()).toBe("from the onTestFinished");
    });
  });

  describe("entered in beforeAll", () => {
    beforeAll(() => {
      storage.enterWith("from beforeAll");
    });

    it("is the store of the first test", () => {
      expect(storage.getStore()).toBe("from beforeAll");
    });

    it("and of the next one, before and after an await", async () => {
      expect(storage.getStore()).toBe("from beforeAll");
      await Promise.resolve();
      expect(storage.getStore()).toBe("from beforeAll");
    });
  });

  describe("entered in beforeEach", () => {
    let runs = 0;
    beforeEach(() => {
      storage.enterWith(`beforeEach run ${++runs}`);
    });

    it("is the store of the test it ran for", () => {
      expect(storage.getStore()).toBe("beforeEach run 1");
    });

    it("and is replaced for the next test", () => {
      expect(storage.getStore()).toBe("beforeEach run 2");
    });
  });

  // disable() splices the storage out of the context array in place rather than replacing it.
  describe("disabled in a later beforeAll", () => {
    beforeAll(() => {
      storage.enterWith("entered before disable()");
    });
    beforeAll(() => {
      storage.disable();
    });

    it("stays gone: run() does not bring the old store back", () => {
      storage.run("inside run()", () => {});
      expect(storage.getStore()).toBeUndefined();
    });
  });
});

describe("a hook registered inside a test under AsyncLocalStorage.run() runs with that store", () => {
  const storage = new AsyncLocalStorage<string>();
  let storeSeenByAfterEach: string | undefined;

  it("registers the hook", () => {
    storage.run("store of the run() that registered it", () => {
      afterEach(() => {
        storeSeenByAfterEach = storage.getStore();
      });
    });
  });

  it("the hook saw the store; the next test does not", () => {
    expect(storeSeenByAfterEach).toBe("store of the run() that registered it");
    expect(storage.getStore()).toBeUndefined();
  });
});
