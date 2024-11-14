//#FILE: test-async-local-storage-snapshot.js
//#SHA1: f8d967194bfb0b73994d296b03c0c43afa5127e5
//-----------------
"use strict";

const { AsyncLocalStorage } = require("async_hooks");

describe("AsyncLocalStorage snapshot", () => {
  test("should preserve the original context when using snapshot", () => {
    const asyncLocalStorage = new AsyncLocalStorage();

    const runInAsyncScope = asyncLocalStorage.run(123, () => AsyncLocalStorage.snapshot());

    const result = asyncLocalStorage.run(321, () => {
      return runInAsyncScope(() => {
        return asyncLocalStorage.getStore();
      });
    });

    expect(result).toBe(123);
  });
});

//<#END_FILE: test-async-local-storage-snapshot.js
