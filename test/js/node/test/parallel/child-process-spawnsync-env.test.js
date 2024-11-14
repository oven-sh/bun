//#FILE: test-child-process-spawnsync-env.js
//#SHA1: 21ad31214e1261fb3c2636bd98d36946e5be67de
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
const cp = require("child_process");

if (process.argv[2] === "child") {
  console.log(process.env.foo);
} else {
  test("spawnSync with custom environment", () => {
    const expected = "bar";
    const child = cp.spawnSync(process.execPath, [__filename, "child"], {
      env: Object.assign({}, process.env, { foo: expected }),
    });

    expect(child.stdout.toString().trim()).toBe(expected);
  });
}

//<#END_FILE: test-child-process-spawnsync-env.js
