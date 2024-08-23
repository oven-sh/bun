//#FILE: test-fs-symlink-dir-junction.js
//#SHA1: 22a1f61cfca41f2dc79675ffadc4f6ec035d6c84
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
const fixtures = require("../common/fixtures");
const fs = require("fs");
const path = require("path");

const tmpdir = path.join(__dirname, "../tmp");

// Test creating and reading symbolic link
test("creating and reading symbolic link", async () => {
  const linkData = fixtures.path("cycles/");
  const linkPath = path.resolve(tmpdir, "cycles_link");

  await fs.promises.mkdir(tmpdir, { recursive: true });

  await fs.promises.symlink(linkData, linkPath, "junction");

  const stats = await fs.promises.lstat(linkPath);
  expect(stats.isSymbolicLink()).toBe(true);

  const destination = await fs.promises.readlink(linkPath);
  expect(destination).toBe(linkData);

  await fs.promises.unlink(linkPath);

  expect(fs.existsSync(linkPath)).toBe(false);
  expect(fs.existsSync(linkData)).toBe(true);
});

// Test invalid symlink
test("invalid symlink", async () => {
  const linkData = fixtures.path("/not/exists/dir");
  const linkPath = path.resolve(tmpdir, "invalid_junction_link");

  await fs.promises.symlink(linkData, linkPath, "junction");

  expect(fs.existsSync(linkPath)).toBe(false);

  await fs.promises.unlink(linkPath);

  expect(fs.existsSync(linkPath)).toBe(false);
});

//<#END_FILE: test-fs-symlink-dir-junction.js
