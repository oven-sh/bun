//#FILE: test-path-posix-relative-on-windows.js
//#SHA1: 2fb8d86d02eea6a077fbca45828aa2433d6a49e6
//-----------------
"use strict";

const path = require("path");

// Refs: https://github.com/nodejs/node/issues/13683

test("path.posix.relative on Windows", () => {
  const relativePath = path.posix.relative("a/b/c", "../../x");
  expect(relativePath).toMatch(/^(\.\.\/){3,5}x$/);
});

//<#END_FILE: test-path-posix-relative-on-windows.js
