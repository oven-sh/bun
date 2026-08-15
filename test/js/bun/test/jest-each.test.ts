import { beforeEach, describe, expect, it } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

const NUMBERS = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
];

describe("jest-each", () => {
  it("check types", () => {
    expect(it.each).toBeTypeOf("function");
    expect(it.each([])).toBeTypeOf("function");
  });
  it.each(NUMBERS)("%i + %i = %i", (a, b, e) => {
    expect(a + b).toBe(e);
  });
  it.each(NUMBERS)("with callback: %f + %d = %f", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    // We cast here because we cannot type done when typing args as ...T
    (done as unknown as (err?: unknown) => void)();
  });
  it.each([
    ["a", "b", "ab"],
    ["c", "d", "cd"],
    ["e", "f", "ef"],
  ])("%s + %s = %s", (a, b, res) => {
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(typeof res).toBe("string");
    expect(a.concat(b)).toBe(res);
  });
  it.each([
    { a: 1, b: 1, e: 2 },
    { a: 1, b: 2, e: 3 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 123, e: 125 },
    { a: 15, b: 13, e: 28 },
  ])("add two numbers with object: %o", ({ a, b, e }, cb) => {
    expect(a + b).toBe(e);
    cb();
  });

  it.each([undefined, null, NaN, Infinity])("stringify %#: %j", (arg, cb) => {
    cb();
  });
});

describe.each(["some", "cool", "strings"])("works with describe: %s", s => {
  it(`has access to params : ${s}`, done => {
    expect(s).toBeTypeOf("string");
    done();
  });
});

describe("does not return zero", () => {
  expect(it.each([1, 2])("wat", () => {})).toBeUndefined();
});

// Callbacks registered while an AsyncLocalStorage store is active run with that store. Registration
// must still look at the function itself: its length decides whether it takes `done`, and `.each`
// binds the row to it.
describe("registered inside an AsyncLocalStorage context", () => {
  const storage = new AsyncLocalStorage<string>();
  storage.run("registration", () => {
    beforeEach(() => {
      expect(storage.getStore()).toBe("registration");
    });
    it("a test without a done parameter is not waited on", () => {
      expect(storage.getStore()).toBe("registration");
    });
    it("a test with a done parameter still gets one", done => {
      expect(storage.getStore()).toBe("registration");
      done();
    });
    it.each(NUMBERS)("it.each: %i + %i = %i", (a, b, e) => {
      expect(a + b).toBe(e);
      expect(storage.getStore()).toBe("registration");
    });
    it.each([[1, 1, 2]])("it.each with a done parameter: %i + %i = %i", (a, b, e, done) => {
      expect(a + b).toBe(e);
      (done as unknown as () => void)();
    });
    describe.each(["nested"])("describe.each: %s", s => {
      it(`keeps the store in ${s} describes`, () => {
        expect(storage.getStore()).toBe("registration");
      });
    });
  });

  // The beforeEach above still runs (with its own store) before this test; its store must not
  // be left behind for a test that was registered outside of it.
  it("a test registered outside of the store does not see it", () => {
    expect(storage.getStore()).toBeUndefined();
  });
});
