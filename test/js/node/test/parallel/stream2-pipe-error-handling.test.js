//#FILE: test-stream2-pipe-error-handling.js
//#SHA1: c5e7ad139c64f22b16e8fff8a62f6f91067087c8
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
const stream = require("stream");

test("stream pipe error handling with autoDestroy true", () => {
  let count = 1000;

  const source = new stream.Readable();
  source._read = function (n) {
    n = Math.min(count, n);
    count -= n;
    source.push(Buffer.allocUnsafe(n));
  };

  let unpipedDest;
  source.unpipe = function (dest) {
    unpipedDest = dest;
    stream.Readable.prototype.unpipe.call(this, dest);
  };

  const dest = new stream.Writable();
  dest._write = function (chunk, encoding, cb) {
    cb();
  };

  source.pipe(dest);

  let gotErr = null;
  dest.on("error", function (err) {
    gotErr = err;
  });

  let unpipedSource;
  dest.on("unpipe", function (src) {
    unpipedSource = src;
  });

  const err = new Error("This stream turned into bacon.");
  dest.emit("error", err);
  expect(gotErr).toBe(err);
  expect(unpipedSource).toBe(source);
  expect(unpipedDest).toBe(dest);
});

test("stream pipe error handling with autoDestroy false", () => {
  let count = 1000;

  const source = new stream.Readable();
  source._read = function (n) {
    n = Math.min(count, n);
    count -= n;
    source.push(Buffer.allocUnsafe(n));
  };

  let unpipedDest;
  source.unpipe = function (dest) {
    unpipedDest = dest;
    stream.Readable.prototype.unpipe.call(this, dest);
  };

  const dest = new stream.Writable({ autoDestroy: false });
  dest._write = function (chunk, encoding, cb) {
    cb();
  };

  source.pipe(dest);

  let unpipedSource;
  dest.on("unpipe", function (src) {
    unpipedSource = src;
  });

  const err = new Error("This stream turned into bacon.");

  let gotErr = null;
  expect(() => {
    dest.emit("error", err);
  }).toThrow(
    expect.objectContaining({
      message: expect.any(String),
    }),
  );
  expect(unpipedSource).toBe(source);
  expect(unpipedDest).toBe(dest);
});

//<#END_FILE: test-stream2-pipe-error-handling.js
