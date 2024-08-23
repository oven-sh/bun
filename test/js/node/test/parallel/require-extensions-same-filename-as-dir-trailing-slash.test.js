//#FILE: test-require-extensions-same-filename-as-dir-trailing-slash.js
//#SHA1: 19a9b40ca5eecf48936c7113bd28647621f4c296
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
const path = require("path");

test("require extensions with same filename as directory and trailing slash", () => {
  const fixtures = path.resolve(__dirname, "..", "fixtures");

  const content = require(
    path.join(fixtures, "json-with-directory-name-module", "module-stub", "one-trailing-slash", "two", "three.js"),
  );

  expect(content).not.toHaveProperty("rocko", "artischocko");
  expect(content).toBe("hello from module-stub!");
});

//<#END_FILE: test-require-extensions-same-filename-as-dir-trailing-slash.js
