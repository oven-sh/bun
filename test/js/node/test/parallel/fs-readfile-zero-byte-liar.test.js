//#FILE: test-fs-readfile-zero-byte-liar.js
//#SHA1: ddca2f114cf32b03f36405a21c81058e7a1f0c18
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

const fs = require("fs");

// Test that readFile works even when stat returns size 0.

const dataExpected = fs.readFileSync(__filename, "utf8");

// Sometimes stat returns size=0, but it's a lie.
fs._fstat = fs.fstat;
fs._fstatSync = fs.fstatSync;

fs.fstat = (fd, cb) => {
  fs._fstat(fd, (er, st) => {
    if (er) return cb(er);
    st.size = 0;
    return cb(er, st);
  });
};

fs.fstatSync = fd => {
  const st = fs._fstatSync(fd);
  st.size = 0;
  return st;
};

test("readFileSync works with zero byte liar", () => {
  const d = fs.readFileSync(__filename, "utf8");
  expect(d).toBe(dataExpected);
});

test("readFile works with zero byte liar", async () => {
  const d = await fs.promises.readFile(__filename, "utf8");
  expect(d).toBe(dataExpected);
});

//<#END_FILE: test-fs-readfile-zero-byte-liar.js
