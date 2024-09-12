//#FILE: test-vm-low-stack-space.js
//#SHA1: fffd6c9c17b9ff755e1dd126a42d6ea176282d00
//-----------------
"use strict";
const vm = require("vm");

test("vm.runInThisContext in low stack space", () => {
  function a() {
    try {
      return a();
    } catch {
      // Throw an exception as near to the recursion-based RangeError as possible.
      return vm.runInThisContext("() => 42")();
    }
  }

  expect(a()).toBe(42);
});

test("vm.runInNewContext in low stack space", () => {
  function b() {
    try {
      return b();
    } catch {
      // This writes a lot of noise to stderr, but it still works.
      return vm.runInNewContext("() => 42")();
    }
  }

  expect(b()).toBe(42);
});

//<#END_FILE: test-vm-low-stack-space.js
