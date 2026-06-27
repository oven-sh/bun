import assert from "assert";
import { AsyncLocalStorage, AsyncResource } from "async_hooks";

test("node async_hooks.AsyncLocalStorage enable disable", async done => {
  const asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

  asyncLocalStorage.run(new Map(), () => {
    asyncLocalStorage.getStore()!.set("foo", "bar");
    process.nextTick(() => {
      assert.strictEqual(asyncLocalStorage.getStore()!.get("foo"), "bar");
      process.nextTick(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
      });

      asyncLocalStorage.disable();
      assert.strictEqual(asyncLocalStorage.getStore(), undefined);

      // Calls to exit() should not mess with enabled status
      asyncLocalStorage.exit(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
      });
      assert.strictEqual(asyncLocalStorage.getStore(), undefined);

      process.nextTick(() => {
        assert.strictEqual(asyncLocalStorage.getStore(), undefined);
        asyncLocalStorage.run(new Map().set("bar", "foo"), () => {
          assert.strictEqual(asyncLocalStorage.getStore()!.get("bar"), "foo");
          done();
        });
      });
    });
  });
});

test("node async_hooks.AsyncLocalStorage enable disable multiple times", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();

  asyncLocalStorage.enterWith("first value");
  expect(asyncLocalStorage.getStore()).toBe("first value");
  asyncLocalStorage.disable();
  expect(asyncLocalStorage.getStore()).toBe(undefined);

  asyncLocalStorage.enterWith("second value");
  expect(asyncLocalStorage.getStore()).toBe("second value");
  asyncLocalStorage.disable();
  expect(asyncLocalStorage.getStore()).toBe(undefined);

  const { promise, resolve, reject } = Promise.withResolvers();
  asyncLocalStorage.run("first run value", () => {
    try {
      expect(asyncLocalStorage.getStore()).toBe("first run value");
      asyncLocalStorage.disable();
      expect(asyncLocalStorage.getStore()).toBe(undefined);
      asyncLocalStorage.run("second run value", () => {
        try {
          expect(asyncLocalStorage.getStore()).toBe("second run value");
          asyncLocalStorage.disable();
          expect(asyncLocalStorage.getStore()).toBe(undefined);

          resolve(undefined);
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      reject(e);
    }
  });

  await promise;
});

test("AsyncResource.prototype.bind", () => {
  const localStorage = new AsyncLocalStorage<true>();
  let ar!: AsyncResource;
  localStorage.run(true, () => {
    ar = new AsyncResource("test");
  });
  expect(ar.bind(() => localStorage.getStore())()).toBe(true);
});

test("AsyncResource.bind", () => {
  const localStorage = new AsyncLocalStorage<true>();
  let fn!: () => true | undefined;
  localStorage.run(true, () => {
    fn = AsyncResource.bind(() => localStorage.getStore());
  });
  expect(fn()).toBe(true);
});

test("AsyncLocalStorage.run after disable() does not leak the store", async () => {
  const als = new AsyncLocalStorage<string>();
  als.run("init", () => {});
  als.disable();
  als.run("leaked", () => {
    expect(als.getStore()).toBe("leaked");
  });
  expect(als.getStore()).toBe(undefined);

  const { promise, resolve } = Promise.withResolvers<string | undefined>();
  setImmediate(() => resolve(als.getStore()));
  expect(await promise).toBe(undefined);
});

test("AsyncLocalStorage.disable inside a nested run does not throw", () => {
  const als = new AsyncLocalStorage<string>();
  let innerResult: number | undefined;
  als.run("outer", () => {
    innerResult = als.run("inner", () => {
      als.disable();
      expect(als.getStore()).toBe(undefined);
      return 42;
    });
    expect(als.getStore()).toBe("outer");
  });
  expect(innerResult).toBe(42);
  expect(als.getStore()).toBe(undefined);
});

test("AsyncLocalStorage.disable inside run with another store active", () => {
  const a = new AsyncLocalStorage<string>();
  const b = new AsyncLocalStorage<string>();
  try {
    b.enterWith("B");
    a.run("A", () => {
      expect(a.getStore()).toBe("A");
      expect(b.getStore()).toBe("B");
      a.disable();
      expect(a.getStore()).toBe(undefined);
      expect(b.getStore()).toBe("B");
    });
    expect(a.getStore()).toBe(undefined);
    expect(b.getStore()).toBe("B");
  } finally {
    a.disable();
    b.disable();
  }
});

test("AsyncLocalStorage.run restores correctly when this store is another store's value", () => {
  const a = new AsyncLocalStorage();
  const b = new AsyncLocalStorage();
  try {
    b.enterWith("x");
    a.run("v", () => {
      // Make `a` appear at an odd (value) slot in the context array.
      b.enterWith(a);
    });
    expect(b.getStore()).toBe(a);
    expect(a.getStore()).toBe(undefined);
  } finally {
    a.disable();
    b.disable();
  }
});

test("AsyncResource.prototype.bind forwards call-site `this` when no thisArg is given", () => {
  const ar = new AsyncResource("test");
  function target(this: unknown) {
    "use strict";
    return this;
  }
  const bound = ar.bind(target);
  const receiver = { bound };
  expect(receiver.bound()).toBe(receiver);
  expect(bound.call(123)).toBe(123);
  expect(bound()).toBe(undefined);
});

test("AsyncResource.prototype.bind sets .length to the target's length", () => {
  const ar = new AsyncResource("test");
  const bound = ar.bind(function (_a: number, _b: number, _c: number) {});
  expect(bound.length).toBe(3);
  const boundWithThis = ar.bind(function (_a: number, _b: number) {}, {});
  expect(boundWithThis.length).toBe(2);
});

test("AsyncResource.prototype.bind with explicit thisArg keeps that receiver", () => {
  const ar = new AsyncResource("test");
  const fixed = { tag: "fixed" };
  function target(this: unknown) {
    return this;
  }
  const bound = ar.bind(target, fixed);
  expect(bound.call({ tag: "ignored" })).toBe(fixed);
});

test("AsyncResource.prototype.emitDestroy returns this", () => {
  const ar = new AsyncResource("test");
  expect(ar.emitDestroy()).toBe(ar);
});
