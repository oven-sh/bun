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

// Every expectation below matches node v26.3.0.
describe("AsyncLocalStorage.disable()", () => {
  test("is callable from inside run()", () => {
    const als = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    als.run("v", () => {
      seen.push(als.getStore());
      als.disable();
      seen.push(als.getStore());
    });
    seen.push(als.getStore());
    expect(seen).toEqual(["v", undefined, undefined]);
  });

  test("does not leak a store entered by a later run()", () => {
    const als = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    als.enterWith("Y");
    als.disable();
    seen.push(als.getStore());
    als.run("v3", () => seen.push(als.getStore()));
    seen.push(als.getStore());
    expect(seen).toEqual([undefined, "v3", undefined]);
  });

  test("does not leak the store of a run() nested inside it", () => {
    const als = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    als.run("Y", () => {
      als.disable();
      als.run("Z", () => seen.push(als.getStore()));
      seen.push(als.getStore());
    });
    seen.push(als.getStore());
    expect(seen).toEqual(["Z", undefined, undefined]);
  });

  test("does not leak another storage's store out of its run()", () => {
    const a = new AsyncLocalStorage<string>();
    const b = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    a.run("A", () => {
      b.run("B", () => a.disable());
      seen.push(b.getStore(), a.getStore());
    });
    expect(seen).toEqual([undefined, undefined]);
  });

  test("leaves an enclosing run()'s store intact", () => {
    const als = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    als.run("A", () => {
      als.run("B", () => als.disable());
      seen.push(als.getStore());
    });
    seen.push(als.getStore());
    expect(seen).toEqual(["A", undefined]);
  });

  test("stays disabled across an await inside run()", async () => {
    const als = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    await als.run("A", async () => {
      als.disable();
      await null;
      seen.push(als.getStore());
    });
    expect(seen).toEqual([undefined]);
  });

  test("drops the store from contexts already captured from the current one", () => {
    const als = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    als.run("x", () => {
      const snapshot = AsyncLocalStorage.snapshot();
      als.disable();
      seen.push(snapshot(() => als.getStore()));
    });
    expect(seen).toEqual([undefined]);
  });

  test("leaves contexts captured from a different one alone", async () => {
    const als = new AsyncLocalStorage<string>();
    const { promise, resolve } = Promise.withResolvers<void>();
    const pending = als.run("x", () => promise.then(() => als.getStore()));
    const snapshot = als.run("s", () => AsyncLocalStorage.snapshot());
    als.disable(); // the root context has no binding for `als`, so this is a no-op
    resolve();
    expect([await pending, snapshot(() => als.getStore())]).toEqual(["x", "s"]);
  });
});

describe("AsyncLocalStorage.run()", () => {
  test("does not roll back the callback when the store is unchanged", () => {
    const als = new AsyncLocalStorage<string>();
    als.enterWith("x");
    als.run("x", () => als.enterWith("y"));
    expect(als.getStore()).toBe("y");
  });

  test("does not resurrect a store the callback disabled when unchanged", () => {
    const als = new AsyncLocalStorage<string>();
    als.enterWith("x");
    als.run("x", () => als.disable());
    expect(als.getStore()).toBeUndefined();
  });

  test("a storage held as another storage's store keeps its own binding", () => {
    const a = new AsyncLocalStorage<AsyncLocalStorage<string>>();
    const b = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    a.run(b, () => {
      // `b` is stored as a value, so it sits at an odd index in the context
      b.run("bval", () => seen.push(b.getStore()));
      seen.push(b.getStore(), a.getStore() === b);
    });
    expect(seen).toEqual(["bval", undefined, true]);
  });
});
