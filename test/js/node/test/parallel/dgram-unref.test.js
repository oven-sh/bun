//#FILE: test-dgram-unref.js
//#SHA1: 97b218a9107def7e2cc28e595f84f9a05a606850
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
const dgram = require("dgram");

test("unref() a socket with a handle", () => {
  const s = dgram.createSocket("udp4");
  s.bind();
  s.unref();
  // No assertion needed, just checking that it doesn't throw
});

test("unref() a socket with no handle", done => {
  const s = dgram.createSocket("udp4");
  s.close(() => {
    s.unref();
    done();
  });
});

test("setTimeout should not be called", () => {
  const mockCallback = jest.fn();
  setTimeout(mockCallback, 1000).unref();
  expect(mockCallback).not.toHaveBeenCalled();
});

//<#END_FILE: test-dgram-unref.js
