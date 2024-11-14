//#FILE: test-async-hooks-recursive-stack-runInAsyncScope.js
//#SHA1: 7258dfd5a442e34e60920fb484336420db8754e2
//-----------------
"use strict";

const async_hooks = require("async_hooks");

// This test verifies that the async ID stack can grow indefinitely.

function recurse(n) {
  const a = new async_hooks.AsyncResource("foobar");
  a.runInAsyncScope(() => {
    expect(a.asyncId()).toBe(async_hooks.executionAsyncId());
    expect(a.triggerAsyncId()).toBe(async_hooks.triggerAsyncId());
    if (n >= 0) recurse(n - 1);
    expect(a.asyncId()).toBe(async_hooks.executionAsyncId());
    expect(a.triggerAsyncId()).toBe(async_hooks.triggerAsyncId());
  });
}

test("async ID stack can grow indefinitely", () => {
  expect(() => recurse(1000)).not.toThrow();
});

//<#END_FILE: test-async-hooks-recursive-stack-runInAsyncScope.js
