//#FILE: test-vm-context-property-forwarding.js
//#SHA1: 611b4eee260bc77dfbaece761208e11a57fe226f
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

test("vm context property forwarding", () => {
  const sandbox = { x: 3 };
  const ctx = vm.createContext(sandbox);

  expect(vm.runInContext("x;", ctx)).toBe(3);
  vm.runInContext("y = 4;", ctx);
  expect(sandbox.y).toBe(4);
  expect(ctx.y).toBe(4);
});

test("IndexedPropertyGetterCallback and IndexedPropertyDeleterCallback", () => {
  const x = {
    get 1() {
      return 5;
    },
  };
  const pd_expected = Object.getOwnPropertyDescriptor(x, 1);
  const ctx2 = vm.createContext(x);
  const pd_actual = Object.getOwnPropertyDescriptor(ctx2, 1);

  expect(pd_actual).toEqual(pd_expected);
  expect(ctx2[1]).toBe(5);
  delete ctx2[1];
  expect(ctx2[1]).toBeUndefined();
});

// https://github.com/nodejs/node/issues/33806
test("property setter error propagation", () => {
  const ctx = vm.createContext();

  Object.defineProperty(ctx, "prop", {
    get() {
      return undefined;
    },
    set() {
      throw new Error("test error");
    },
  });

  expect(() => {
    vm.runInContext("prop = 42", ctx);
  }).toThrow(
    expect.objectContaining({
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-vm-context-property-forwarding.js
