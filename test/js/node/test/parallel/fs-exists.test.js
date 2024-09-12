//#FILE: test-fs-exists.js
//#SHA1: b7dcbc226b81e0ae4a111cbab39b87672a02172c
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
const fs = require("fs");
const f = __filename;

test("fs.exists throws with invalid arguments", () => {
  expect(() => fs.exists(f)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  expect(() => fs.exists()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  expect(() => fs.exists(f, {})).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
});

test("fs.exists with valid file", done => {
  fs.exists(f, y => {
    expect(y).toBe(true);
    done();
  });
});

test("fs.exists with non-existent file", done => {
  fs.exists(`${f}-NO`, y => {
    expect(y).toBe(false);
    done();
  });
});

test("fs.exists with invalid path", done => {
  fs.exists(new URL("https://foo"), y => {
    expect(y).toBe(false);
    done();
  });
});

test("fs.exists with object as path", done => {
  fs.exists({}, y => {
    expect(y).toBe(false);
    done();
  });
});

test("fs.existsSync", () => {
  expect(fs.existsSync(f)).toBe(true);
  expect(fs.existsSync(`${f}-NO`)).toBe(false);
});

test("fs.existsSync never throws", () => {
  expect(fs.existsSync()).toBe(false);
  expect(fs.existsSync({})).toBe(false);
  expect(fs.existsSync(new URL("https://foo"))).toBe(false);
});

//<#END_FILE: test-fs-exists.js
