//#FILE: test-fs-write-stream-end.js
//#SHA1: a4194cfb1f416f5fddd5edc55b7d867db14a5320
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
const path = require("path");
const os = require("os");

const tmpdir = {
  refresh: () => {
    // Implementation of tmpdir.refresh() is not provided in the original code
    // This is a placeholder and might need to be adjusted based on actual implementation
  },
  resolve: filename => path.join(os.tmpdir(), filename),
};

beforeEach(() => {
  tmpdir.refresh();
});

test("write stream end without data", done => {
  const file = tmpdir.resolve("write-end-test0.txt");
  const stream = fs.createWriteStream(file);
  stream.end();
  stream.on("close", () => {
    expect(true).toBe(true);
    done();
  });
});

test("write stream end with data", done => {
  const file = tmpdir.resolve("write-end-test1.txt");
  const stream = fs.createWriteStream(file);
  stream.end("a\n", "utf8");
  stream.on("close", () => {
    const content = fs.readFileSync(file, "utf8");
    expect(content).toBe("a\n");
    done();
  });
});

test("write stream end and open event", done => {
  const file = tmpdir.resolve("write-end-test2.txt");
  const stream = fs.createWriteStream(file);
  stream.end();

  let calledOpen = false;
  stream.on("open", () => {
    calledOpen = true;
  });
  stream.on("finish", () => {
    expect(calledOpen).toBe(true);
    done();
  });
});
