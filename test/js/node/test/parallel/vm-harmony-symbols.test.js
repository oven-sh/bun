//#FILE: test-vm-harmony-symbols.js
//#SHA1: 36768ab105e0bcc19dccae0fea22801068fdaedd
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
const vm = require("vm");

test("The sandbox should have its own Symbol constructor", () => {
  let sandbox = {};
  vm.runInNewContext("this.Symbol = Symbol", sandbox);
  expect(typeof sandbox.Symbol).toBe("function");
  expect(sandbox.Symbol).not.toBe(Symbol);
});

test("Explicitly copying the Symbol constructor", () => {
  let sandbox = { Symbol };
  vm.runInNewContext("this.Symbol = Symbol", sandbox);
  expect(typeof sandbox.Symbol).toBe("function");
  expect(sandbox.Symbol).toBe(Symbol);
});

//<#END_FILE: test-vm-harmony-symbols.js
