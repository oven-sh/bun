import { expect, test } from "bun:test";

test("not implemented yet module masquerades as undefined and throws an error", () => {
  const worker_threads = import.meta.require("worker_threads");

  expect(typeof worker_threads).toBe("undefined");
  expect(typeof worker_threads.getEnvironmentData).toBe("undefined");
});

test("AsyncLocalStorage polyfill", () => {
  const { AsyncLocalStorage } = import.meta.require("async_hooks");

  const store = new AsyncLocalStorage();
  var called = false;
  expect(store.getStore()).toBe(null);
  store.run({ foo: "bar" }, () => {
    expect(store.getStore()).toEqual({ foo: "bar" });
    called = true;
  });
  expect(store.getStore()).toBe(null);
  expect(called).toBe(true);
});

test("AsyncResource polyfill", () => {
  const { AsyncResource } = import.meta.require("async_hooks");

  const resource = new AsyncResource("test");
  var called = false;
  resource.runInAsyncScope(
    () => {
      called = true;
    },
    null,
    "foo",
    "bar",
  );
  expect(called).toBe(true);
});
