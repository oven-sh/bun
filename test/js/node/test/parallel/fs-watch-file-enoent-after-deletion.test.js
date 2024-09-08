//#FILE: test-fs-watch-file-enoent-after-deletion.js
//#SHA1: d6c93db608d119bd35fcab0e1e9307bfd6558b68
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

// Make sure the deletion event gets reported in the following scenario:
// 1. Watch a file.
// 2. The initial stat() goes okay.
// 3. Something deletes the watched file.
// 4. The second stat() fails with ENOENT.

// The second stat() translates into the first 'change' event but a logic error
// stopped it from getting emitted.
// https://github.com/nodejs/node-v0.x-archive/issues/4027

test("fs.watchFile reports deletion", done => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
  const filename = path.join(tmpdir, "watched");
  fs.writeFileSync(filename, "quis custodiet ipsos custodes");

  const watcher = jest.fn();
  fs.watchFile(filename, { interval: 50 }, watcher);

  setTimeout(() => {
    fs.unlinkSync(filename);

    setTimeout(() => {
      expect(watcher).toHaveBeenCalledTimes(1);
      const [curr, prev] = watcher.mock.calls[0];
      expect(curr.nlink).toBe(0);
      expect(prev.nlink).toBe(1);

      fs.unwatchFile(filename);
      fs.rmdirSync(tmpdir);
      done();
    }, 100);
  }, 100);
});

//<#END_FILE: test-fs-watch-file-enoent-after-deletion.js
