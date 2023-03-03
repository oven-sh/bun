import { expect, test } from "bun:test";

// test("not implemented yet module masquerades as undefined and throws an error", () => {
//   const worker_threads = import.meta.require("worker_threads");

//   expect(typeof worker_threads).toBe("undefined");
//   expect(typeof worker_threads.getEnvironmentData).toBe("undefined");
// });

test("AsyncContext", async done => {
  const { AsyncContext } = import.meta.require("async_hooks");
  console.log("here");
  const ctx = new AsyncContext();
  ctx
    .run(1234, async () => {
      expect(ctx.get()).toBe(1234);
      console.log("here");
      await 1;
      console.log("ctx", ctx.get());
      const setTimeoutResult = await ctx.run(
        2345,
        () =>
          new Promise(resolve => {
            queueMicrotask(() => {
              console.log("queueMicrotask", ctx.get());
              resolve(ctx.get());
            });
          }),
      );
      expect(setTimeoutResult).toBe(2345);
      expect(ctx.get()).toBe(1234);
      return "final result";
    })
    .then(result => {
      expect(result).toBe("final result");
      // The code that generated the Promise has access to the 1234
      // value provided to ctx.run above, but consumers of the Promise
      // do not automatically inherit it.
      expect(ctx.get()).toBeUndefined();
      done();
    });
});

// test("AsyncLocalStorage polyfill", () => {
//   const { AsyncLocalStorage } = import.meta.require("async_hooks");

//   const store = new AsyncLocalStorage();
//   var called = false;
//   expect(store.getStore()).toBe(null);
//   store.run({ foo: "bar" }, () => {
//     expect(store.getStore()).toEqual({ foo: "bar" });
//     called = true;
//   });
//   expect(store.getStore()).toBe(null);
//   expect(called).toBe(true);
// });

// test("AsyncResource polyfill", () => {
//   const { AsyncResource } = import.meta.require("async_hooks");

//   const resource = new AsyncResource("test");
//   var called = false;
//   resource.runInAsyncScope(
//     () => {
//       called = true;
//     },
//     null,
//     "foo",
//     "bar",
//   );
//   expect(called).toBe(true);
// });
