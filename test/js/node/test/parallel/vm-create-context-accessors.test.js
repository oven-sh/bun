//#FILE: test-vm-create-context-accessors.js
//#SHA1: af7f3fb956333bd0669014a9e3c8f3f308efc68e
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

test("vm.createContext with accessors", () => {
  let ctx = {};

  Object.defineProperty(ctx, "getter", {
    get: function () {
      return "ok";
    },
  });

  let val;
  Object.defineProperty(ctx, "setter", {
    set: function (_val) {
      val = _val;
    },
    get: function () {
      return `ok=${val}`;
    },
  });

  ctx = vm.createContext(ctx);

  const result = vm.runInContext('setter = "test";[getter,setter]', ctx);
  expect(result[0]).toBe("ok");
  expect(result[1]).toBe("ok=test");
});

//<#END_FILE: test-vm-create-context-accessors.js
