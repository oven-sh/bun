import { expect, test } from "bun:test";
import { AsyncResource, AsyncLocalStorage } from "async_hooks";
import * as worker_threads from "worker_threads";
import worker_threads_default from "worker_threads";

test("not implemented yet module masquerades as undefined and throws an error", () => {
  expect(typeof worker_threads.default).toBe("undefined");
  expect(typeof worker_threads_default).toBe("undefined");
  expect(typeof worker_threads.getEnvironmentData).toBe("undefined");
  expect(typeof worker_threads_default.getEnvironmentData).toBe("undefined");
});

test("AsyncLocalStorage polyfill", () => {
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
  const resource = new AsyncResource("prisma-client-request");
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

test("esbuild functions with worker_threads stub", async () => {
  const esbuild = await import("esbuild");
  const result = await esbuild.transform('console . log( "hello world" )', { minify: true });
  expect(result.code).toBe('console.log("hello world");\n');
});
