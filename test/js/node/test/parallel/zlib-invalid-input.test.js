//#FILE: test-zlib-invalid-input.js
//#SHA1: b76d7dde545ea75c25000ee36864841cf73951e0
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
// Test uncompressing invalid input

const zlib = require("zlib");

const nonStringInputs = [1, true, { a: 1 }, ["a"]];

// zlib.Unzip classes need to get valid data, or else they'll throw.
const unzips = [zlib.Unzip(), zlib.Gunzip(), zlib.Inflate(), zlib.InflateRaw(), zlib.BrotliDecompress()];

test("zlib.gunzip throws TypeError for non-string inputs", () => {
  nonStringInputs.forEach(input => {
    expect(() => {
      zlib.gunzip(input);
    }).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.any(String),
      }),
    );
  });
});

test("unzip classes emit error for invalid compressed data", done => {
  let completedCount = 0;

  unzips.forEach((uz, i) => {
    uz.on("error", err => {
      expect(err).toBeTruthy();
      completedCount++;
      if (completedCount === unzips.length) {
        done();
      }
    });

    uz.on("end", () => {
      throw new Error("end event should not be emitted");
    });

    // This will trigger error event
    uz.write("this is not valid compressed data.");
  });
});

//<#END_FILE: test-zlib-invalid-input.js
