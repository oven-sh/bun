//#FILE: test-vm-deleting-property.js
//#SHA1: 20a3a3752a4d1b140cd8762c1d66c8dc734ed3fa
//-----------------
"use strict";
// Refs: https://github.com/nodejs/node/issues/6287

const vm = require("vm");

test("deleting property in vm context", () => {
  const context = vm.createContext();
  const res = vm.runInContext(
    `
    this.x = 'prop';
    delete this.x;
    Object.getOwnPropertyDescriptor(this, 'x');
  `,
    context,
  );

  expect(res).toBeUndefined();
});

//<#END_FILE: test-vm-deleting-property.js
