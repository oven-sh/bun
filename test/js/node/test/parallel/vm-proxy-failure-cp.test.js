//#FILE: test-vm-proxy-failure-CP.js
//#SHA1: d3eb5284a94f718a6ae1e07c0b30e01dad295ea9
//-----------------
"use strict";
const vm = require("vm");

// Check that we do not accidentally query attributes.
// Issue: https://github.com/nodejs/node/issues/11902
test("vm does not accidentally query attributes", () => {
  const handler = {
    getOwnPropertyDescriptor: (target, prop) => {
      throw new Error("whoops");
    },
  };
  const sandbox = new Proxy({ foo: "bar" }, handler);
  const context = vm.createContext(sandbox);

  expect(() => {
    vm.runInContext("", context);
  }).not.toThrow();
});

//<#END_FILE: test-vm-proxy-failure-CP.js
