//#FILE: test-stream2-readable-wrap-empty.js
//#SHA1: aaac82ec7df0743321f2aaacd9512ecf1b932ad6
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
const EventEmitter = require("events");

test("Readable.wrap with empty stream", done => {
  const oldStream = new EventEmitter();
  oldStream.pause = jest.fn();
  oldStream.resume = jest.fn();

  const newStream = new Readable().wrap(oldStream);

  newStream
    .on("readable", () => {})
    .on("end", () => {
      done();
    });

  oldStream.emit("end");
});

//<#END_FILE: test-stream2-readable-wrap-empty.js
