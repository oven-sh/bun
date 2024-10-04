//#FILE: test-stream-push-strings.js
//#SHA1: d2da34fc74795ea8cc46460ce443d0b30b0e98d8
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

const { Readable } = require("stream");

class MyStream extends Readable {
  constructor(options) {
    super(options);
    this._chunks = 3;
  }

  _read(n) {
    switch (this._chunks--) {
      case 0:
        return this.push(null);
      case 1:
        return setTimeout(() => {
          this.push("last chunk");
        }, 100);
      case 2:
        return this.push("second to last chunk");
      case 3:
        return process.nextTick(() => {
          this.push("first chunk");
        });
      default:
        throw new Error("?");
    }
  }
}

test("MyStream pushes strings correctly", done => {
  const ms = new MyStream();
  const results = [];
  ms.on("readable", function () {
    let chunk;
    while (null !== (chunk = ms.read())) results.push(String(chunk));
  });

  const expected = ["first chunksecond to last chunk", "last chunk"];

  ms.on("end", () => {
    expect(ms._chunks).toBe(-1);
    expect(results).toEqual(expected);
    done();
  });
});

//<#END_FILE: test-stream-push-strings.js
