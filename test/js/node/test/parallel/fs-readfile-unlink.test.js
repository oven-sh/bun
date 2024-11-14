//#FILE: test-fs-readfile-unlink.js
//#SHA1: a7107747d7901dfcc1ffd0e7adbf548412a1016a
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

// Test that unlink succeeds immediately after readFile completes.

test("unlink succeeds immediately after readFile completes", async () => {
  const tmpdir = path.join(os.tmpdir(), "node-test-fs-readfile-unlink");
  await fs.promises.mkdir(tmpdir, { recursive: true });

  const fileName = path.join(tmpdir, "test.bin");
  const buf = Buffer.alloc(512 * 1024, 42);

  await fs.promises.writeFile(fileName, buf);

  const data = await fs.promises.readFile(fileName);

  expect(data.length).toBe(buf.length);
  expect(data[0]).toBe(42);

  // Unlink should not throw. This is part of the test. It used to throw on
  // Windows due to a bug.
  await expect(fs.promises.unlink(fileName)).resolves.toBeUndefined();
});

//<#END_FILE: test-fs-readfile-unlink.js
