//#FILE: test-stream2-compatibility.js
//#SHA1: 4767fa4655235101bee847c06850d6db3b71d1cd
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

let ondataCalled = 0;

class TestReader extends R {
  constructor() {
    super();
    this._buffer = Buffer.alloc(100, "x");

    this.on("data", () => {
      ondataCalled++;
    });
  }

  _read(n) {
    this.push(this._buffer);
    this._buffer = Buffer.alloc(0);
  }
}

class TestWriter extends W {
  constructor() {
    super();
    this.write("foo");
    this.end();
  }

  _write(chunk, enc, cb) {
    cb();
  }
}

test("TestReader emits data once", done => {
  const reader = new TestReader();
  setImmediate(() => {
    expect(ondataCalled).toBe(1);
    reader.push(null);
    done();
  });
});

test("TestWriter ends correctly", () => {
  const writer = new TestWriter();
  expect(writer.writable).toBe(false);
});

test("TestReader becomes unreadable", done => {
  const reader = new TestReader();
  reader.on("end", () => {
    expect(reader.readable).toBe(false);
    done();
  });
  reader.push(null);
});

//<#END_FILE: test-stream2-compatibility.js
