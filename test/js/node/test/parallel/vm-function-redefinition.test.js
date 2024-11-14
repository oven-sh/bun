//#FILE: test-vm-function-redefinition.js
//#SHA1: afca30c05276f19448e4a2e01381c8a6fb13d544
//-----------------
"use strict";
// Refs: https://github.com/nodejs/node/issues/548
const vm = require("vm");

test("function redefinition in vm context", () => {
  const context = vm.createContext();

  vm.runInContext("function test() { return 0; }", context);
  vm.runInContext("function test() { return 1; }", context);
  const result = vm.runInContext("test()", context);
  expect(result).toBe(1);
});

//<#END_FILE: test-vm-function-redefinition.js
