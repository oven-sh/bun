//#FILE: test-child-process-fork-close.js
//#SHA1: d196e4b4f06991be7c2a48169cb89b815c0f172b
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
const { fork } = require("child_process");
const path = require("path");

test("child process fork close events", async () => {
  const cp = fork(path.resolve(__dirname, "../fixtures/child-process-message-and-exit.js"));

  let gotMessage = false;
  let gotExit = false;
  let gotClose = false;

  const messagePromise = new Promise(resolve => {
    cp.on("message", message => {
      expect(gotMessage).toBe(false);
      expect(gotClose).toBe(false);
      expect(message).toBe("hello");
      gotMessage = true;
      resolve();
    });
  });

  const exitPromise = new Promise(resolve => {
    cp.on("exit", () => {
      expect(gotExit).toBe(false);
      expect(gotClose).toBe(false);
      gotExit = true;
      resolve();
    });
  });

  const closePromise = new Promise(resolve => {
    cp.on("close", () => {
      expect(gotMessage).toBe(true);
      expect(gotExit).toBe(true);
      expect(gotClose).toBe(false);
      gotClose = true;
      resolve();
    });
  });

  await Promise.all([messagePromise, exitPromise, closePromise]);
});

//<#END_FILE: test-child-process-fork-close.js
