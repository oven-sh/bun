//#FILE: test-global-domexception.js
//#SHA1: 9a8d5eacea5ae98814fa6312b5f10089034c1ef4
//-----------------
"use strict";

// This test checks the global availability and behavior of DOMException

test("DOMException is a global function", () => {
  expect(typeof DOMException).toBe("function");
});

test("atob throws a DOMException for invalid input", () => {
  expect(() => {
    atob("我要抛错！");
  }).toThrow(DOMException);
});

//<#END_FILE: test-global-domexception.js
