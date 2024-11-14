//#FILE: test-child-process-set-blocking.js
//#SHA1: 2855d3d616c7af61fc6b84705cd05515f02bcb47
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
const { spawn } = require("child_process");
const os = require("os");

const SIZE = 100000;
const python = process.env.PYTHON || (os.platform() === "win32" ? "python" : "python3");

test("child process set blocking", done => {
  const cp = spawn(python, ["-c", `print(${SIZE} * "C")`], {
    stdio: "inherit",
  });

  cp.on("exit", code => {
    expect(code).toBe(0);
    done();
  });
});

//<#END_FILE: test-child-process-set-blocking.js
