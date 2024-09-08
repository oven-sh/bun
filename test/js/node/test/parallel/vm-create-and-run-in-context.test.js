//#FILE: test-vm-create-and-run-in-context.js
//#SHA1: 4583962cfdb3266d8b850442cec0b4cfa49bc6d2
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
// Flags: --expose-gc

const vm = require("vm");

describe("vm.createContext and vm.runInContext", () => {
  test("Run in a new empty context", () => {
    const context = vm.createContext();
    const result = vm.runInContext('"passed";', context);
    expect(result).toBe("passed");
  });

  test("Create a new pre-populated context", () => {
    const context = vm.createContext({ foo: "bar", thing: "lala" });
    expect(context.foo).toBe("bar");
    expect(context.thing).toBe("lala");
  });

  test("Test updating context", () => {
    const context = vm.createContext({ foo: "bar", thing: "lala" });
    vm.runInContext("var foo = 3;", context);
    expect(context.foo).toBe(3);
    expect(context.thing).toBe("lala");
  });

  test("Run in contextified sandbox without referencing the context", () => {
    // https://github.com/nodejs/node/issues/5768
    const sandbox = { x: 1 };
    vm.createContext(sandbox);
    global.gc();
    vm.runInContext("x = 2", sandbox);
    // Should not crash.
    expect(sandbox.x).toBe(2);
  });
});

//<#END_FILE: test-vm-create-and-run-in-context.js
