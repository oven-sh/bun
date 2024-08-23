//#FILE: test-fs-stream-double-close.js
//#SHA1: 25fa219f7ee462e67611751f996393afc1869490
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
const path = require("path");
const os = require("os");

const tmpdir = path.join(os.tmpdir(), "node-test-fs-stream-double-close");
beforeAll(() => {
  if (!fs.existsSync(tmpdir)) {
    fs.mkdirSync(tmpdir, { recursive: true });
  }
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test("test1 with ReadStream", () => {
  test1(fs.createReadStream(__filename));
});

test("test2 with ReadStream", () => {
  test2(fs.createReadStream(__filename));
});

test("test3 with ReadStream", () => {
  test3(fs.createReadStream(__filename));
});

test("test1 with WriteStream", () => {
  test1(fs.createWriteStream(path.join(tmpdir, "dummy1")));
});

test("test2 with WriteStream", () => {
  test2(fs.createWriteStream(path.join(tmpdir, "dummy2")));
});

test("test3 with WriteStream", () => {
  test3(fs.createWriteStream(path.join(tmpdir, "dummy3")));
});

function test1(stream) {
  stream.destroy();
  stream.destroy();
}

function test2(stream) {
  stream.destroy();
  stream.on("open", jest.fn());
}

function test3(stream) {
  const openHandler = jest.fn();
  stream.on("open", openHandler);
  stream.emit("open");
  expect(openHandler).toHaveBeenCalledTimes(1);
  stream.destroy();
  stream.destroy();
}

//<#END_FILE: test-fs-stream-double-close.js
