//#FILE: test-child-process-exec-cwd.js
//#SHA1: b45f4e5e1b308a55015c242bcbeb9c5ffe897ab9
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
const { exec } = require("child_process");
const os = require("os");

let pwdcommand, dir;

if (os.platform() === "win32") {
  pwdcommand = "echo %cd%";
  dir = "c:\\windows";
} else {
  pwdcommand = "pwd";
  dir = "/dev";
}

test("exec with cwd option", async () => {
  await new Promise((resolve, reject) => {
    exec(pwdcommand, { cwd: dir }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      expect(stdout.toLowerCase()).toMatch(new RegExp(`^${dir.toLowerCase()}`));
      resolve();
    });
  });
});

//<#END_FILE: test-child-process-exec-cwd.js
