//#FILE: test-zlib-close-after-write.js
//#SHA1: 7fad593914e2a23d73598e4366e685b9aa91cc24
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
const zlib = require("zlib");

test("zlib close after write", async () => {
  const gzipPromise = new Promise((resolve, reject) => {
    zlib.gzip("hello", (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });

  const out = await gzipPromise;

  const unzip = zlib.createGunzip();
  unzip.write(out);

  const closePromise = new Promise(resolve => {
    unzip.close(resolve);
  });

  await closePromise;
});

//<#END_FILE: test-zlib-close-after-write.js
