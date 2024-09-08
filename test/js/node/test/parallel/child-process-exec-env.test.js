//#FILE: test-child-process-exec-env.js
//#SHA1: cba9b5f7a9d1ab7cd674bde00c1c4184470e4899
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
const { isWindows } = require("../common");
const { exec } = require("child_process");
const util = require("util");

const execPromise = util.promisify(exec);

test("exec with custom environment", async () => {
  let command, options;

  if (!isWindows) {
    command = "/usr/bin/env";
    options = { env: { HELLO: "WORLD" } };
  } else {
    command = "set";
    options = { env: { ...process.env, HELLO: "WORLD" } };
  }

  const { stdout, stderr } = await execPromise(command, options);

  expect(stdout).not.toBe("");
  expect(stdout).toContain("HELLO=WORLD");
  expect(stderr).toBe("");
});

//<#END_FILE: test-child-process-exec-env.js
