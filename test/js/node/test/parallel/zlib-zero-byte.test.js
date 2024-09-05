//#FILE: test-zlib-zero-byte.js
//#SHA1: 54539c28619fb98230547ba0929ddad146f15bc5
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

for (const Compressor of [zlib.Gzip, zlib.BrotliCompress]) {
  test(`${Compressor.name} compresses zero-byte input`, async () => {
    const gz = Compressor();
    const emptyBuffer = Buffer.alloc(0);
    let received = 0;

    gz.on("data", c => {
      received += c.length;
    });

    const endPromise = new Promise(resolve => {
      gz.on("end", resolve);
    });

    const finishPromise = new Promise(resolve => {
      gz.on("finish", resolve);
    });

    gz.write(emptyBuffer);
    gz.end();

    await Promise.all([endPromise, finishPromise]);

    const expected = Compressor === zlib.Gzip ? 20 : 1;
    expect(received).toBe(expected);
  });
}

//<#END_FILE: test-zlib-zero-byte.js
