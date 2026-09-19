// https://github.com/oven-sh/bun/issues/29513
//
// AsyncDisposableStack.prototype.disposeAsync() was not awaiting the promise
// returned from each resource's [Symbol.asyncDispose](). JavaScriptCore's
// GetDisposeMethod wrapped the method in a closure that called it for its
// side effects only, discarded the returned promise, and synchronously
// returned Promise.resolve(undefined). As a result, disposeAsync() resolved
// immediately (before any async cleanup finished) and resources were not
// disposed sequentially.
//
// Per https://tc39.es/proposal-explicit-resource-management/#sec-disposeresources,
// each resource's [Symbol.asyncDispose]() result must be awaited before the
// next resource (in LIFO order) is disposed.

import { expect, test } from "bun:test";

test("AsyncDisposableStack.disposeAsync awaits each resource sequentially (use)", async () => {
  const events: string[] = [];
  const deferred: PromiseWithResolvers<void>[] = [];

  class Resource implements AsyncDisposable {
    constructor(public readonly label: string) {}
    [Symbol.asyncDispose]() {
      events.push(`begin ${this.label}`);
      const d = Promise.withResolvers<void>();
      deferred.push(d);
      return d.promise.then(() => {
        events.push(`end ${this.label}`);
      });
    }
  }

  const stack = new AsyncDisposableStack();
  stack.use(new Resource("r1"));
  stack.use(new Resource("r2"));
  stack.use(new Resource("r3"));

  let disposed = false;
  const disposal = stack.disposeAsync().then(() => {
    disposed = true;
  });

  // disposeAsync() calls the first (LIFO: r3) disposer synchronously, so it
  // has already begun. Nothing else should have started yet, and the overall
  // promise must still be pending.
  expect(events).toEqual(["begin r3"]);
  expect(disposed).toBe(false);

  // Let r3 resolve. r2 should begin only after r3 has ended.
  deferred[0].resolve();
  await Bun.sleep(0);
  expect(events).toEqual(["begin r3", "end r3", "begin r2"]);
  expect(disposed).toBe(false);

  // Let r2 resolve. r1 should begin only after r2 has ended.
  deferred[1].resolve();
  await Bun.sleep(0);
  expect(events).toEqual(["begin r3", "end r3", "begin r2", "end r2", "begin r1"]);
  expect(disposed).toBe(false);

  // Let r1 resolve. Now disposeAsync() should resolve.
  deferred[2].resolve();
  await disposal;

  expect(events).toEqual(["begin r3", "end r3", "begin r2", "end r2", "begin r1", "end r1"]);
  expect(disposed).toBe(true);
});

test("AsyncDisposableStack.disposeAsync awaits adopt() callbacks", async () => {
  // adopt()'s wrapper closure had the same bug: it invoked the callback and
  // dropped the returned promise on the floor.
  const events: string[] = [];
  const d1 = Promise.withResolvers<void>();
  const d2 = Promise.withResolvers<void>();

  const stack = new AsyncDisposableStack();
  stack.adopt("a", label => {
    events.push(`begin ${label}`);
    return d1.promise.then(() => {
      events.push(`end ${label}`);
    });
  });
  stack.adopt("b", label => {
    events.push(`begin ${label}`);
    return d2.promise.then(() => {
      events.push(`end ${label}`);
    });
  });

  let disposed = false;
  const disposal = stack.disposeAsync().then(() => {
    disposed = true;
  });

  expect(events).toEqual(["begin b"]);
  expect(disposed).toBe(false);

  d2.resolve();
  await Bun.sleep(0);
  expect(events).toEqual(["begin b", "end b", "begin a"]);
  expect(disposed).toBe(false);

  d1.resolve();
  await disposal;
  expect(events).toEqual(["begin b", "end b", "begin a", "end a"]);
  expect(disposed).toBe(true);
});

// https://github.com/oven-sh/bun/issues/24277
//
// The same broken GetDisposeMethod implementation checked isCallable before
// checking for undefined/null, so passing a resource that only defined
// [Symbol.dispose] (no [Symbol.asyncDispose]) threw "@@asyncDispose must be
// callable" instead of falling back to the sync dispose method per
// https://tc39.es/proposal-explicit-resource-management/#sec-getdisposemethod.
test("AsyncDisposableStack.use falls back to Symbol.dispose when Symbol.asyncDispose is absent", async () => {
  const events: string[] = [];

  const stack = new AsyncDisposableStack();
  stack.use({
    async [Symbol.asyncDispose]() {
      events.push("async dispose");
    },
  });
  // Previously threw "TypeError: @@asyncDispose must be callable" at use().
  stack.use({
    [Symbol.dispose]() {
      events.push("sync dispose");
    },
  });

  await stack.disposeAsync();
  expect(events).toEqual(["sync dispose", "async dispose"]);
});

test("AsyncDisposableStack.disposeAsync awaits defer() callbacks", async () => {
  const events: string[] = [];
  const d = Promise.withResolvers<void>();

  const stack = new AsyncDisposableStack();
  stack.defer(() => {
    events.push("begin");
    return d.promise.then(() => {
      events.push("end");
    });
  });

  let disposed = false;
  const disposal = stack.disposeAsync().then(() => {
    disposed = true;
  });

  expect(events).toEqual(["begin"]);
  await Bun.sleep(0);
  expect(disposed).toBe(false);

  d.resolve();
  await disposal;
  expect(events).toEqual(["begin", "end"]);
  expect(disposed).toBe(true);
});
