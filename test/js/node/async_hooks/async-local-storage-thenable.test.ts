import { AsyncLocalStorage } from "async_hooks";
import { createTest } from "node-harness";
const store = new AsyncLocalStorage();
const data = Symbol("verifier");

const { beforeAll, describe, expect, it, throws, assert, createCallCheckCtx, createDoneDotAll } = createTest(
  import.meta.path,
);

test("node.js test test-async-local-storage-no-mix-contexts.js", async () => {
  const asyncLocalStorage = new AsyncLocalStorage();
  const err = new Error();
  const next = () =>
    Promise.resolve().then(() => {
      assert.strictEqual(asyncLocalStorage.getStore().get("a"), 1);
      throw err;
    });
  await new Promise((resolve, reject) => {
    asyncLocalStorage.run(new Map(), () => {
      const store = asyncLocalStorage.getStore();
      store.set("a", 1);
      next().then(resolve, reject);
    });
  }).catch(e => {
    assert.strictEqual(asyncLocalStorage.getStore(), undefined);
    assert.strictEqual(e, err);
  });
  assert.strictEqual(asyncLocalStorage.getStore(), undefined);
});

test("await custom thenable", async () => {
  const { resolve, promise } = Promise.withResolvers();
  function thenable() {
    return {
      then(handle: CallableFunction) {
        assert.strictEqual(store.getStore(), data);
        handle();
      },
    };
  }
  // Await a thenable
  await store.run(data, async () => {
    assert.strictEqual(store.getStore(), data);
    await (thenable() as any);
    assert.strictEqual(store.getStore(), data);
    resolve(undefined);
  });

  await promise;
});

test("Returning a thenable in an async function", async done => {
  const { mustCall } = createCallCheckCtx(done);
  const then: Function = mustCall(cb => {
    assert.strictEqual(store.getStore(), data);
    process.nextTick(cb);
  }, 1);

  function thenable() {
    return {
      then,
    };
  }

  await store.run(data, async () => {
    try {
      assert.strictEqual(store.getStore(), data);
      return thenable();
    } finally {
      assert.strictEqual(store.getStore(), data);
    }
  });
});

test("Resolving a thenable", async done => {
  const { mustCall } = createCallCheckCtx(done);
  const then: Function = mustCall(cb => {
    assert.strictEqual(store.getStore(), data);
    process.nextTick(cb);
  }, 1);

  function thenable() {
    return {
      then,
    };
  }

  await store.run(data, () => {
    assert.strictEqual(store.getStore(), data);
    Promise.resolve(thenable());
    assert.strictEqual(store.getStore(), data);
  });
});

test("Returning a thenable in a then handler", async done => {
  const { mustCall } = createCallCheckCtx(done);
  const then: Function = mustCall(cb => {
    assert.strictEqual(store.getStore(), data);
    process.nextTick(cb);
  }, 1);

  function thenable() {
    return {
      then,
    };
  }

  await store.run(data, () => {
    assert.strictEqual(store.getStore(), data);
    Promise.resolve().then(() => thenable());
    assert.strictEqual(store.getStore(), data);
  });
});
