//#FILE: test-fs-truncate-clear-file-zero.js
//#SHA1: 28aa057c9903ea2436c340ccecfec093c647714c
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

// This test ensures that `fs.truncate` opens the file with `r+` and not `w`,
// which had earlier resulted in the target file's content getting zeroed out.
// https://github.com/nodejs/node-v0.x-archive/issues/6233

const filename = path.join(os.tmpdir(), "truncate-file.txt");

beforeEach(() => {
  // Clean up any existing test file
  try {
    fs.unlinkSync(filename);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
});

test("fs.truncateSync", () => {
  fs.writeFileSync(filename, "0123456789");
  expect(fs.readFileSync(filename, "utf8")).toBe("0123456789");
  fs.truncateSync(filename, 5);
  expect(fs.readFileSync(filename, "utf8")).toBe("01234");
});

test("fs.truncate", async () => {
  fs.writeFileSync(filename, "0123456789");
  expect(fs.readFileSync(filename, "utf8")).toBe("0123456789");

  await new Promise((resolve, reject) => {
    fs.truncate(filename, 5, err => {
      if (err) reject(err);
      else resolve();
    });
  });

  expect(fs.readFileSync(filename, "utf8")).toBe("01234");
});

//<#END_FILE: test-fs-truncate-clear-file-zero.js
