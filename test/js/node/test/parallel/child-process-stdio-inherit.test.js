//#FILE: test-child-process-stdio-inherit.js
//#SHA1: d2a66eb4284084371cc2da3dfdf659ed108c7803
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

if (process.argv[2] === "parent") {
  parent();
} else {
  test("grandparent process", async () => {
    const child = spawn(process.execPath, [__filename, "parent"]);
    child.stderr.pipe(process.stderr);
    let output = "";
    const input = "asdfasdf";

    child.stdout.on("data", chunk => {
      output += chunk;
    });
    child.stdout.setEncoding("utf8");

    child.stdin.end(input);

    await new Promise(resolve => {
      child.on("close", (code, signal) => {
        expect(code).toBe(0);
        expect(signal).toBeNull();
        // 'cat' on windows adds a \r\n at the end.
        expect(output.trim()).toBe(input.trim());
        resolve();
      });
    });
  });
}

function parent() {
  // Should not immediately exit.
  spawn("cat", [], { stdio: "inherit" });
}

//<#END_FILE: test-child-process-stdio-inherit.js
