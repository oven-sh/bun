//#FILE: test-zlib-dictionary-fail.js
//#SHA1: e9c6d383f9b0a202067a125c016f1ef3cd5be558
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

// String "test" encoded with dictionary "dict".
const input = Buffer.from([0x78, 0xbb, 0x04, 0x09, 0x01, 0xa5]);

test("zlib.createInflate without dictionary", async () => {
  const stream = zlib.createInflate();

  await expect(
    new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.write(input);
    }),
  ).rejects.toThrow(
    expect.objectContaining({
      message: expect.stringMatching(/Missing dictionary/),
    }),
  );
});

test("zlib.createInflate with wrong dictionary", async () => {
  const stream = zlib.createInflate({ dictionary: Buffer.from("fail") });

  await expect(
    new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.write(input);
    }),
  ).rejects.toThrow(
    expect.objectContaining({
      message: expect.stringMatching(/Bad dictionary/),
    }),
  );
});

test("zlib.createInflateRaw with wrong dictionary", async () => {
  const stream = zlib.createInflateRaw({ dictionary: Buffer.from("fail") });

  await expect(
    new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.write(input);
    }),
  ).rejects.toThrow(
    expect.objectContaining({
      message: expect.stringMatching(/(invalid|Operation-Ending-Supplemental Code is 0x12)/),
    }),
  );
});

//<#END_FILE: test-zlib-dictionary-fail.js
