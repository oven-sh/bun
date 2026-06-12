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

// https://github.com/oven-sh/bun/issues/32168
test("AsyncResource assigns unique asyncIds", () => {
  const a = new AsyncResource("a");
  const b = new AsyncResource("b");
  expect(typeof a.asyncId()).toBe("number");
  expect(a.asyncId()).toBeGreaterThan(1);
  expect(b.asyncId()).toBeGreaterThan(a.asyncId());
});

test("executionAsyncId/triggerAsyncId reflect runInAsyncScope", () => {
  const outerExecutionAsyncId = executionAsyncId();
  const outerTriggerAsyncId = triggerAsyncId();

  const a = new AsyncResource("a");
  expect(a.asyncId()).not.toBe(outerExecutionAsyncId);
  expect(a.triggerAsyncId()).toBe(outerExecutionAsyncId);

  const ret = a.runInAsyncScope(() => {
    expect(executionAsyncId()).toBe(a.asyncId());
    expect(triggerAsyncId()).toBe(a.triggerAsyncId());

    const nested = new AsyncResource("nested");
    expect(nested.triggerAsyncId()).toBe(a.asyncId());
    nested.runInAsyncScope(() => {
      expect(executionAsyncId()).toBe(nested.asyncId());
      expect(triggerAsyncId()).toBe(nested.triggerAsyncId());
    });
    expect(executionAsyncId()).toBe(a.asyncId());
    return "ran";
  });
  expect(ret).toBe("ran");

  expect(executionAsyncId()).toBe(outerExecutionAsyncId);
  expect(triggerAsyncId()).toBe(outerTriggerAsyncId);
});

test("executionAsyncId is restored when runInAsyncScope throws", () => {
  const outerExecutionAsyncId = executionAsyncId();
  const a = new AsyncResource("a");
  expect(a.asyncId()).not.toBe(outerExecutionAsyncId);
  expect(() =>
    a.runInAsyncScope(() => {
      expect(executionAsyncId()).toBe(a.asyncId());
      throw new Error("boom");
    }),
  ).toThrow("boom");
  expect(executionAsyncId()).toBe(outerExecutionAsyncId);
});

test("explicit triggerAsyncId is honored", () => {
  expect(new AsyncResource("a", 7).triggerAsyncId()).toBe(7);
  expect(new AsyncResource("a", { triggerAsyncId: 9 }).triggerAsyncId()).toBe(9);
});
