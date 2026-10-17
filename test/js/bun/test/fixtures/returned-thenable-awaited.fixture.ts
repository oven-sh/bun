import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, onTestFinished, test } from "bun:test";
import vm from "node:vm";
import { LazyPromise, notAwaited, SettledPromise, thenable } from "./returned-thenable";

// Every entry is pushed on a later turn of the event loop than the callback that returned the value.
// The order at the end only holds if the runner waited for each returned value.
const order: string[] = [];
const later = (name: string, finish: () => void) =>
  setImmediate(() => {
    order.push(name);
    finish();
  });
const finishesLater = (name: string) => thenable(resolve => later(name, resolve));

const thenCalls = { getterRead: 0, getterCalled: 0, withDone: 0, proxyRead: 0, patched: 0 };

// The callback types do not allow these return values. The runner treats each as a synchronous return.
const notAwaitable: Record<string, unknown> = {
  "an object": { value: 1 },
  "an object whose then is not callable": { then: "then" },
  "an array": [],
  "a function": () => {},
  "a mock function": mock(),
  "a string": "then",
};

describe("a thenable from", () => {
  beforeAll(() => finishesLater("beforeAll"));
  beforeEach(() => finishesLater("beforeEach"));
  afterEach(() => finishesLater("afterEach"));
  afterAll(() => finishesLater("afterAll"));

  test("a test", () => {
    onTestFinished(() => finishesLater("onTestFinished"));
    return finishesLater("test");
  });
  test.each(["a", "b"])("test.each row %s", row => finishesLater("row " + row));
});

describe("a lazy Promise subclass from", () => {
  beforeEach(() => new LazyPromise<void>(resolve => later("lazy beforeEach", resolve)));
  test("a test", () => new LazyPromise<void>(resolve => later("lazy test", resolve)));
});

describe("a hook that returns the thenable it stores", () => {
  let stored: PromiseLike<void> | undefined;
  // Without braces the arrow returns the value, so the hook awaits it.
  beforeAll(() => (stored = finishesLater("stored by beforeAll")));
  test("awaits it", () => {
    expect(stored).toBeDefined();
  });
});

test("an already fulfilled Promise subclass", () =>
  new SettledPromise(() => new Promise<void>(resolve => later("settled subclass", resolve))));

test("a thenable whose then is a getter", () => {
  const value = {
    get then() {
      thenCalls.getterRead++;
      return (resolve: () => void) => {
        thenCalls.getterCalled++;
        later("then getter", resolve);
      };
    },
  };
  return value as unknown as PromiseLike<void>;
});

test("a function with a then()", () => {
  const value = Object.assign(() => {}, { then: (resolve: () => void) => later("function with then", resolve) });
  return value as unknown as PromiseLike<void>;
});

test("a thenable that resolves with a thenable", () =>
  thenable(resolve => resolve(finishesLater("resolved with a thenable"))));

test("a thenable that calls resolve, then reject", () =>
  thenable((resolve, reject) => {
    resolve();
    reject(new Error("reject after resolve"));
  }));

test("a promise from another realm", () =>
  vm.runInNewContext("new Promise(resolve => later('other realm', resolve))", { later }));

let attempts = 0;
test(
  "a rejection in the first attempt does not fail the retry",
  () => (++attempts === 1 ? thenable((_resolve, reject) => reject(new Error("first attempt"))) : finishesLater("retry")),
  { retry: 1 },
);

// then() runs in the drain that follows the callback, before the next test of the group starts.
const concurrent: string[] = [];
describe.concurrent("in a concurrent group", () => {
  test("the first test returns a thenable", () => {
    concurrent.push("first body");
    return thenable(resolve => {
      concurrent.push("first then");
      resolve();
    });
  });
  test("the second test starts after that then()", () => {
    concurrent.push("second body");
  });
});

test("a Proxy: then is read once", () => {
  const proxy = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "then") thenCalls.proxyRead++;
        return undefined;
      },
    },
  );
  return proxy as unknown as void;
});

for (const [name, value] of Object.entries(notAwaitable)) {
  test(name + " is a synchronous return", () => value as void);
}

test("a done callback with a thenable: then is not read, only done is awaited", done => {
  later("done", done);
  const value = {
    get then() {
      thenCalls.withDone++;
      return () => {};
    },
  };
  return value as unknown as PromiseLike<void>;
});

test("a done callback with a lazy Promise subclass: the subclass is started", done =>
  new LazyPromise<void>(resolve =>
    later("done with lazy subclass", () => {
      resolve();
      done();
    }),
  ));

// Last, because replacing Promise.prototype.then makes every later object return take the slow path.
test("a native promise while Promise.prototype.then is replaced", async () => {
  const original = Promise.prototype.then;
  Promise.prototype.then = function (this: Promise<unknown>, ...args: Parameters<typeof original>) {
    thenCalls.patched++;
    return original.apply(this, args);
  } as typeof original;
  try {
    await new Promise<void>(resolve => later("patched then", resolve));
  } finally {
    Promise.prototype.then = original;
  }
});

for (const [name, value] of Object.entries(notAwaitable)) {
  test(name + " is a synchronous return after then was replaced", () => value as void);
}

test("every value was awaited in order, through one then() call", () => {
  expect(order).toEqual([
    "beforeAll",
    "beforeEach",
    "test",
    "afterEach",
    "onTestFinished",
    "beforeEach",
    "row a",
    "afterEach",
    "beforeEach",
    "row b",
    "afterEach",
    "afterAll",
    "lazy beforeEach",
    "lazy test",
    "stored by beforeAll",
    "settled subclass",
    "then getter",
    "function with then",
    "resolved with a thenable",
    "other realm",
    "retry",
    "done",
    "done with lazy subclass",
    "patched then",
  ]);
  expect(concurrent).toEqual(["first body", "first then", "second body"]);
  expect({
    ...thenCalls,
    lazy: LazyPromise.thenCalls,
    settled: SettledPromise.thenCalls,
    startedByTheFixture: notAwaited.count,
  }).toEqual({
    getterRead: 1,
    getterCalled: 1,
    withDone: 0,
    proxyRead: 1,
    patched: 0,
    lazy: 3,
    settled: 1,
    startedByTheFixture: 0,
  });
});
