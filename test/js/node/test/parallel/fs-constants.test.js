//#FILE: test-fs-constants.js
//#SHA1: 6113ac0dd5e6b3d59252a25e6ddae61b589ca362
//-----------------
"use strict";

const fs = require("fs");

test("fs constants for Windows chmod() are defined", () => {
  expect(fs.constants.S_IRUSR).toBeDefined();
  expect(fs.constants.S_IWUSR).toBeDefined();
});

//<#END_FILE: test-fs-constants.js
