import assert from "assert";
import { AsyncLocalStorage, AsyncResource } from "async_hooks";
import { inspect } from "util";

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

test("node async_hooks.AsyncLocalStorage has no own keys and no method for util.inspect()", () => {
  const asyncLocalStorage = new AsyncLocalStorage({ name: "storage", defaultValue: 1 });
  expect({
    ownKeys: Reflect.ownKeys(asyncLocalStorage),
    inspected: inspect(asyncLocalStorage),
    nested: inspect({ asyncLocalStorage }, { depth: 0 }),
  }).toEqual({
    ownKeys: [],
    inspected: "AsyncLocalStorage {}",
    nested: "{ asyncLocalStorage: AsyncLocalStorage {} }",
  });
});

test("node async_hooks.AsyncLocalStorage disable() with a receiver that is no storage", () => {
  assert.strictEqual(AsyncLocalStorage.prototype.disable.call(undefined), undefined);
});

test("AsyncLocalStorage and AsyncResource in a job that the factory of a module mock scheduled", async () => {
  const asyncLocalStorage = new AsyncLocalStorage<number>();
  let job!: Promise<unknown[]>;
  // The job runs in the async context of the factory. The storage of its innermost frame is the mock, and
  // a mock of vi.doMock() throws when an export that its factory did not return is read.
  using _ = vi.doMock("./module-of-a-mock-factory.ts", () => {
    job = Promise.resolve().then(() => [
      asyncLocalStorage.getStore(),
      asyncLocalStorage.run(2, () => new AsyncResource("x")).runInAsyncScope(() => asyncLocalStorage.getStore()),
      AsyncLocalStorage.snapshot()(() => asyncLocalStorage.getStore()),
    ]);
    return { value: "mocked" };
  });
  const { value } = await import("./module-of-a-mock-factory.ts" as string);
  expect({ value, job: await job }).toEqual({ value: "mocked", job: [undefined, 2, undefined] });
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
