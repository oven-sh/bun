//#FILE: test-fs-promises-exists.js
//#SHA1: 3766c49e29d13338f3124165428e3a8a37d47fab
//-----------------
"use strict";

const fs = require("fs");
const fsPromises = require("fs/promises");

test("fs.promises exists and is correctly linked", () => {
  expect(fsPromises).toBe(fs.promises);
  expect(fsPromises.constants).toBe(fs.constants);
});

//<#END_FILE: test-fs-promises-exists.js
