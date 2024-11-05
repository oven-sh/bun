//#FILE: test-vm-function-declaration.js
//#SHA1: 002bfe8201b2483628b46efd3d5e081fb17fc4b4
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

test("Function declaration and expression in vm context", () => {
  const o = vm.createContext({ console });

  // Function declaration and expression should both be copied to the
  // sandboxed context.
  let code = "let a = function() {};\n";
  code += "function b(){}\n";
  code += "var c = function() {};\n";
  code += "var d = () => {};\n";
  code += "let e = () => {};\n";

  // Grab the global b function as the completion value, to ensure that
  // we are getting the global function, and not some other thing
  code += "(function(){return this})().b;\n";

  const res = vm.runInContext(code, o, "test");

  expect(typeof res).toBe("function");
  expect(res.name).toBe("b");
  expect(typeof o.a).toBe("undefined");
  expect(typeof o.b).toBe("function");
  expect(typeof o.c).toBe("function");
  expect(typeof o.d).toBe("function");
  expect(typeof o.e).toBe("undefined");
  expect(res).toBe(o.b);
});

//<#END_FILE: test-vm-function-declaration.js
