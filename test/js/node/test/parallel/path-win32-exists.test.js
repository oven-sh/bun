//#FILE: test-path-win32-exists.js
//#SHA1: 7d5cfa1f0fc5a13f9878eddd3b119b9c488fecc5
//-----------------
"use strict";

test("path/win32 exists and is the same as path.win32", () => {
  expect(require("path/win32")).toBe(require("path").win32);
});

//<#END_FILE: test-path-win32-exists.js
