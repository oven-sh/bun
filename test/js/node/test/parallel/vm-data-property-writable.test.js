//#FILE: test-vm-data-property-writable.js
//#SHA1: fc562132c9b5c9f17d55e08df7456dea7a1f41e3
//-----------------
"use strict";
// Refs: https://github.com/nodejs/node/issues/10223

const vm = require("vm");

test("vm data property writable", () => {
  const context = vm.createContext({});

  let code = `
     Object.defineProperty(this, 'foo', {value: 5});
     Object.getOwnPropertyDescriptor(this, 'foo');
  `;

  let desc = vm.runInContext(code, context);

  expect(desc.writable).toBe(false);

  // Check that interceptors work for symbols.
  code = `
     const bar = Symbol('bar');
     Object.defineProperty(this, bar, {value: 6});
     Object.getOwnPropertyDescriptor(this, bar);
  `;

  desc = vm.runInContext(code, context);

  expect(desc.value).toBe(6);
});

//<#END_FILE: test-vm-data-property-writable.js
