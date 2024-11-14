//#FILE: test-stream2-readable-legacy-drain.js
//#SHA1: 8182fd1e12ce8538106404d39102ea69eee2e467
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
const Stream = require("stream");
const Readable = Stream.Readable;

test("Readable stream with legacy drain", done => {
  const r = new Readable();
  const N = 256;
  let reads = 0;
  r._read = function (n) {
    return r.push(++reads === N ? null : Buffer.allocUnsafe(1));
  };

  const onEnd = jest.fn();
  r.on("end", onEnd);

  const w = new Stream();
  w.writable = true;
  let buffered = 0;
  w.write = function (c) {
    buffered += c.length;
    process.nextTick(drain);
    return false;
  };

  function drain() {
    expect(buffered).toBeLessThanOrEqual(3);
    buffered = 0;
    w.emit("drain");
  }

  const endSpy = jest.fn();
  w.end = endSpy;

  r.pipe(w);

  // Wait for the 'end' event to be emitted
  r.on("end", () => {
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);
    done();
  });
});

//<#END_FILE: test-stream2-readable-legacy-drain.js
