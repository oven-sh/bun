//#FILE: test-vm-global-assignment.js
//#SHA1: 54d8ce4e5d93c89a8573a3230065f4e244b198db
//-----------------
"use strict";

// Regression test for https://github.com/nodejs/node/issues/10806

const vm = require("vm");

describe("VM global assignment", () => {
  let ctx;
  let window;
  const other = 123;

  beforeEach(() => {
    ctx = vm.createContext({ open() {} });
    window = vm.runInContext("this", ctx);
  });

  test("window.open is not equal to other initially", () => {
    expect(window.open).not.toBe(other);
  });

  test("window.open can be assigned", () => {
    window.open = other;
    expect(window.open).toBe(other);
  });

  test("window.open can be reassigned", () => {
    window.open = other;
    window.open = other;
    expect(window.open).toBe(other);
  });
});

//<#END_FILE: test-vm-global-assignment.js
