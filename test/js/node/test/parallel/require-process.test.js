//#FILE: test-require-process.js
//#SHA1: 699b499b3f906d140de0d550c310085aa0791c95
//-----------------
"use strict";

test('require("process") should return global process reference', () => {
  const nativeProcess = require("process");
  expect(nativeProcess).toBe(process);
});

//<#END_FILE: test-require-process.js
