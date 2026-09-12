import assert from "assert";
import { AsyncLocalStorage, AsyncResource, createHook, executionAsyncId, triggerAsyncId } from "async_hooks";

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

test("createHook init fires for AsyncResource construction", () => {
  const events: Array<{ asyncId: number; type: string; triggerAsyncId: number; resource: unknown }> = [];
  const hook = createHook({
    init(asyncId, type, triggerAsyncId, resource) {
      if (type === "MY_HOOKED_RESOURCE") events.push({ asyncId, type, triggerAsyncId, resource });
    },
  }).enable();
  try {
    const a = new AsyncResource("MY_HOOKED_RESOURCE");
    expect(events).toEqual([
      { asyncId: a.asyncId(), type: "MY_HOOKED_RESOURCE", triggerAsyncId: a.triggerAsyncId(), resource: a },
    ]);
  } finally {
    hook.disable();
  }
});

test("TickObject init receives the current executionAsyncId as its triggerAsyncId", async () => {
  const triggers: number[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  const hook = createHook({
    init(asyncId, type, triggerAsyncId, resource) {
      // Match our tick exactly; the runtime may schedule unrelated ticks.
      if (type === "TickObject" && (resource as { callback?: unknown })?.callback === resolve) {
        triggers.push(triggerAsyncId);
      }
    },
  }).enable();
  try {
    const a = new AsyncResource("T");
    expect(a.asyncId()).toBeGreaterThan(1);
    a.runInAsyncScope(() => {
      process.nextTick(resolve);
    });
    await promise;
    expect(triggers).toEqual([a.asyncId()]);
  } finally {
    hook.disable();
  }
});
