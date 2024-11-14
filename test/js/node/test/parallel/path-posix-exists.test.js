//#FILE: test-path-posix-exists.js
//#SHA1: 4bd4c9ef3ffd03623fefbdedd28732c21fd10956
//-----------------
"use strict";

// The original test file used Node.js specific modules and assertions.
// We'll convert this to use Jest's testing framework while maintaining
// the same behavior and allowing it to run in both Node.js and Bun.

test("path/posix module exists and is identical to path.posix", () => {
  // In Jest, we don't need to explicitly require assert
  // We'll use Jest's expect API instead

  // We still need to require the path module
  const path = require("path");

  // Check if the path/posix module is the same as path.posix
  expect(require("path/posix")).toBe(path.posix);
});

//<#END_FILE: test-path-posix-exists.js
