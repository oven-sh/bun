import { expect, test } from "bun:test";

// https://tc39.es/ecma262/#sec-promise.withResolvers creates the result's data
// properties in the order promise, resolve, reject. JSC built the object on a
// structure laid out as resolve, reject, promise (oven-sh/WebKit#603).

test("Promise.withResolvers() result has its keys in spec order", () => {
  const result = Promise.withResolvers<number>();
  expect(Object.keys(result)).toEqual(["promise", "resolve", "reject"]);
  expect(Reflect.ownKeys(result)).toEqual(["promise", "resolve", "reject"]);
  expect(JSON.stringify(result, (key, value) => (typeof value === "function" ? "function" : value))).toBe(
    `{"promise":{},"resolve":"function","reject":"function"}`,
  );
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  for (const key of ["promise", "resolve", "reject"] as const) {
    expect(Object.getOwnPropertyDescriptor(result, key)).toMatchObject({
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
});

test("Promise.withResolvers() on a subclass and on a foreign constructor uses the same order", () => {
  class Derived<T> extends Promise<T> {}
  const derived = Promise.withResolvers.call(Derived);
  expect(Object.keys(derived)).toEqual(["promise", "resolve", "reject"]);
  expect(derived.promise).toBeInstanceOf(Derived);

  const calls: unknown[][] = [];
  function NotAPromise(this: any, executor: (resolve: (v: unknown) => void, reject: (r: unknown) => void) => void) {
    executor(
      value => calls.push(["resolve", value]),
      reason => calls.push(["reject", reason]),
    );
  }
  const foreign = Promise.withResolvers.call(NotAPromise as any);
  expect(Object.keys(foreign)).toEqual(["promise", "resolve", "reject"]);
  expect(foreign.promise).toBeInstanceOf(NotAPromise);
  foreign.resolve(1);
  foreign.reject(2);
  expect(calls).toEqual([
    ["resolve", 1],
    ["reject", 2],
  ]);
});

test("resolve and reject still settle the promise they came with", async () => {
  {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    resolve(42);
    reject(new Error("ignored"));
    expect(await promise).toBe(42);
  }
  {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    reject(42);
    resolve(7);
    expect(
      await promise.then(
        () => "fulfilled",
        (reason: unknown) => ["rejected", reason],
      ),
    ).toEqual(["rejected", 42]);
  }
});
