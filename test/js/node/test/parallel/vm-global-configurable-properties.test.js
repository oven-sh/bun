//#FILE: test-vm-global-configurable-properties.js
//#SHA1: abaa38afe456cd1fcf98be472781d25e3918d1b5
//-----------------
"use strict";
// https://github.com/nodejs/node/issues/47799

const vm = require("vm");

test("VM global configurable properties", () => {
  const ctx = vm.createContext();

  const window = vm.runInContext("this", ctx);

  Object.defineProperty(window, "x", { value: "1", configurable: true });
  expect(window.x).toBe("1");

  Object.defineProperty(window, "x", { value: "2", configurable: true });
  expect(window.x).toBe("2");
});

//<#END_FILE: test-vm-global-configurable-properties.js
