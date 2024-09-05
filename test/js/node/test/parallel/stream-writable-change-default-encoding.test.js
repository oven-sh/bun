//#FILE: test-stream-writable-change-default-encoding.js
//#SHA1: 7a4e7c22888d4901899fe5a0ed4604c319f73ff9
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

class MyWritable extends stream.Writable {
  constructor(fn, options) {
    super(options);
    this.fn = fn;
  }

  _write(chunk, encoding, callback) {
    this.fn(Buffer.isBuffer(chunk), typeof chunk, encoding);
    callback();
  }
}

test("default encoding is utf8", () => {
  const m = new MyWritable(
    (isBuffer, type, enc) => {
      expect(enc).toBe("utf8");
    },
    { decodeStrings: false },
  );
  m.write("foo");
  m.end();
});

test("change default encoding to ascii", () => {
  const m = new MyWritable(
    (isBuffer, type, enc) => {
      expect(enc).toBe("ascii");
    },
    { decodeStrings: false },
  );
  m.setDefaultEncoding("ascii");
  m.write("bar");
  m.end();
});

test("change default encoding to invalid value", () => {
  const m = new MyWritable((isBuffer, type, enc) => {}, { decodeStrings: false });

  expect(() => {
    m.setDefaultEncoding({});
    m.write("bar");
    m.end();
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_UNKNOWN_ENCODING",
      message: expect.any(String),
    }),
  );
});

test("check variable case encoding", () => {
  const m = new MyWritable(
    (isBuffer, type, enc) => {
      expect(enc).toBe("ascii");
    },
    { decodeStrings: false },
  );
  m.setDefaultEncoding("AsCii");
  m.write("bar");
  m.end();
});

//<#END_FILE: test-stream-writable-change-default-encoding.js
