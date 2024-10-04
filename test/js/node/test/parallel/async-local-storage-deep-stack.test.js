//#FILE: test-async-local-storage-deep-stack.js
//#SHA1: 305d85dc794f55b19fffebfbb720ba0c83714f63
//-----------------
"use strict";

const { AsyncLocalStorage } = require("async_hooks");

// Regression test for: https://github.com/nodejs/node/issues/34556

test("AsyncLocalStorage deep stack", () => {
  const als = new AsyncLocalStorage();

  const done = jest.fn();

  function run(count) {
    if (count !== 0) return als.run({}, run, --count);
    done();
  }

  run(1000);

  expect(done).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-async-local-storage-deep-stack.js
