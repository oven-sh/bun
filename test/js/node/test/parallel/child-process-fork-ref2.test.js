//#FILE: test-child-process-fork-ref2.js
//#SHA1: 6d8a2bec4198f9d9f71ce9f2cc880cfcd1c9d883
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
const { debuglog } = require("util");
const debug = debuglog("test");

const platformTimeout = ms => ms;

if (process.argv[2] === "child") {
  test("child process", () => {
    debug("child -> call disconnect");
    process.disconnect();

    return new Promise(resolve => {
      setTimeout(() => {
        debug("child -> will this keep it alive?");
        const mockFn = jest.fn();
        process.on("message", mockFn);
        expect(mockFn).not.toHaveBeenCalled();
        resolve();
      }, platformTimeout(400));
    });
  });
} else {
  test("parent process", () => {
    return new Promise(resolve => {
      const child = fork(__filename, ["child"]);

      const disconnectSpy = jest.fn(() => {
        debug("parent -> disconnect");
      });
      child.on("disconnect", disconnectSpy);

      const exitSpy = jest.fn(() => {
        debug("parent -> exit");
        expect(disconnectSpy).toHaveBeenCalledTimes(1);
        resolve();
      });
      child.once("exit", exitSpy);

      expect(exitSpy).toHaveBeenCalledTimes(0);
    });
  });
}

//<#END_FILE: test-child-process-fork-ref2.js
