//#FILE: test-vm-strict-mode.js
//#SHA1: ab6c6c72920e9bf095b41b255872b9d0604301c7
//-----------------
"use strict";
// https://github.com/nodejs/node/issues/12300

const vm = require("vm");

test("vm strict mode assignment", () => {
  const ctx = vm.createContext({ x: 42 });

  // This might look as if x has not been declared, but x is defined on the
  // sandbox and the assignment should not throw.
  expect(() => {
    vm.runInContext('"use strict"; x = 1', ctx);
  }).not.toThrow();

  expect(ctx.x).toBe(1);
});

//<#END_FILE: test-vm-strict-mode.js
