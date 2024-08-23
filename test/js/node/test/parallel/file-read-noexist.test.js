//#FILE: test-file-read-noexist.js
//#SHA1: c4cbb5dc6abca53c1dd513a4ece2741c1fc2235a
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

const filename = path.join(__dirname, "fixtures", "does_not_exist.txt");

test("fs.readFile with non-existent file", async () => {
  await expect(
    new Promise((resolve, reject) => {
      fs.readFile(filename, "latin1", (err, content) => {
        if (err) reject(err);
        else resolve(content);
      });
    }),
  ).rejects.toMatchObject({
    code: "ENOENT",
    message: expect.any(String),
  });
});

//<#END_FILE: test-file-read-noexist.js
