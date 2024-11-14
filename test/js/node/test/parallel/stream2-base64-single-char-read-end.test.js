//#FILE: test-stream2-base64-single-char-read-end.js
//#SHA1: 7d3b8e9ad3f47e915bc265658c0b5639fa4a68cd
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
const { Readable: R, Writable: W } = require("stream");

test("stream2 base64 single char read end", async () => {
  const src = new R({ encoding: "base64" });
  const dst = new W();
  let hasRead = false;
  const accum = [];

  src._read = function (n) {
    if (!hasRead) {
      hasRead = true;
      process.nextTick(function () {
        src.push(Buffer.from("1"));
        src.push(null);
      });
    }
  };

  dst._write = function (chunk, enc, cb) {
    accum.push(chunk);
    cb();
  };

  const endPromise = new Promise(resolve => {
    src.on("end", resolve);
  });

  src.pipe(dst);

  await Promise.race([
    endPromise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for _write")), 100);
    }),
  ]);

  expect(String(Buffer.concat(accum))).toBe("MQ==");
});

//<#END_FILE: test-stream2-base64-single-char-read-end.js
