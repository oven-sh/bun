//#FILE: test-vm-indexed-properties.js
//#SHA1: 5938ca1da86f05ceda978b0f2d9640734d6c0ab6
//-----------------
"use strict";

const vm = require("vm");

test("vm indexed properties", () => {
  const code = `Object.defineProperty(this, 99, {
    value: 20,
    enumerable: true
  });`;

  const sandbox = {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);

  expect(sandbox[99]).toBe(20);
});

//<#END_FILE: test-vm-indexed-properties.js
