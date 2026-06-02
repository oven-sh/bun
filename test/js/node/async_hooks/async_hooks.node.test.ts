import assert from "assert";
import { AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId } from "async_hooks";

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

// https://github.com/oven-sh/bun/issues/31709
test("AsyncResource.prototype.asyncId returns a unique, monotonically increasing id", () => {
  const a = new AsyncResource("MY_ASYNC_RESOURCE");
  const b = new AsyncResource("MY_ASYNC_RESOURCE");

  // Each resource gets a positive integer id (0 was the old stub value).
  expect(a.asyncId()).toBeGreaterThan(0);
  expect(Number.isSafeInteger(a.asyncId())).toBe(true);

  // Ids are unique and increase for later resources.
  expect(b.asyncId()).toBeGreaterThan(a.asyncId());

  // asyncId() is stable across calls, including after emitDestroy().
  const id = a.asyncId();
  a.emitDestroy();
  expect(a.asyncId()).toBe(id);
  expect(a.asyncId()).toBe(id);
});

test("AsyncResource.prototype.triggerAsyncId reflects the triggerAsyncId option", () => {
  // No opts defaults to the current executionAsyncId() (1 at the top level).
  expect(new AsyncResource("T").triggerAsyncId()).toBe(1);
  // Object opts.
  expect(new AsyncResource("T", { triggerAsyncId: 42 }).triggerAsyncId()).toBe(42);
  expect(new AsyncResource("T", { triggerAsyncId: 0 }).triggerAsyncId()).toBe(0);
  // Numeric opts is treated as the triggerAsyncId.
  expect(new AsyncResource("T", 7).triggerAsyncId()).toBe(7);
});

test("AsyncResource.prototype.emitDestroy returns the resource", () => {
  const a = new AsyncResource("T");
  expect(a.emitDestroy()).toBe(a);
  // Repeated calls keep returning the resource.
  expect(a.emitDestroy()).toBe(a);
});

test("runInAsyncScope makes executionAsyncId()/triggerAsyncId() match the resource", () => {
  const a = new AsyncResource("foobar");

  // At the top level Node reports executionAsyncId() === 1 (root).
  const outerExecutionId = executionAsyncId();
  expect(outerExecutionId).toBe(1);

  a.runInAsyncScope(() => {
    // Inside the scope, the free functions report the resource's (non-zero) ids.
    expect(executionAsyncId()).toBeGreaterThan(1);
    expect(executionAsyncId()).toBe(a.asyncId());
    expect(triggerAsyncId()).toBe(a.triggerAsyncId());

    // A resource created inside the scope inherits the current executionAsyncId()
    // as its triggerAsyncId, whether or not an options object is passed.
    const b = new AsyncResource("bar");
    const c = new AsyncResource("baz", {});
    expect(b.triggerAsyncId()).toBe(a.asyncId());
    expect(c.triggerAsyncId()).toBe(a.asyncId());

    // Nesting restores correctly on exit.
    b.runInAsyncScope(() => {
      expect(executionAsyncId()).toBe(b.asyncId());
      expect(triggerAsyncId()).toBe(b.triggerAsyncId());
    });
    expect(executionAsyncId()).toBe(a.asyncId());
  });

  // Restored to the outer value once the scope exits.
  expect(executionAsyncId()).toBe(outerExecutionId);
});
