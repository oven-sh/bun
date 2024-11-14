//#FILE: test-child-process-kill.js
//#SHA1: 308c453d51a13e0e2c640969456c0092ab00967d
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
const isWindows = process.platform === "win32";

test("child process kill behavior", async () => {
  const cat = spawn(isWindows ? "cmd" : "cat");

  const stdoutEndPromise = new Promise(resolve => {
    cat.stdout.on("end", resolve);
  });

  const stderrDataPromise = new Promise((resolve, reject) => {
    cat.stderr.on("data", () => reject(new Error("stderr should not receive data")));
    cat.stderr.on("end", resolve);
  });

  const exitPromise = new Promise(resolve => {
    cat.on("exit", (code, signal) => {
      expect(code).toBeNull();
      expect(signal).toBe("SIGTERM");
      expect(cat.signalCode).toBe("SIGTERM");
      resolve();
    });
  });

  expect(cat.signalCode).toBeNull();
  expect(cat.killed).toBe(false);
  cat.kill();
  expect(cat.killed).toBe(true);

  await Promise.all([stdoutEndPromise, stderrDataPromise, exitPromise]);
});

//<#END_FILE: test-child-process-kill.js
