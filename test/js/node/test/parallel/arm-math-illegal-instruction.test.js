//#FILE: test-arm-math-illegal-instruction.js
//#SHA1: 08aea7234b93dfe296564c6dd21a58bc91acd9dd
//-----------------
"use strict";

// This test ensures Math functions don't fail with an "illegal instruction"
// error on ARM devices (primarily on the Raspberry Pi 1)
// See https://github.com/nodejs/node/issues/1376
// and https://code.google.com/p/v8/issues/detail?id=4019

test("Math functions do not fail with illegal instruction on ARM devices", () => {
  // Iterate over all Math functions
  Object.getOwnPropertyNames(Math).forEach(functionName => {
    if (!/[A-Z]/.test(functionName)) {
      // The function names don't have capital letters.
      expect(() => Math[functionName](-0.5)).not.toThrow();
    }
  });
});

//<#END_FILE: test-arm-math-illegal-instruction.js
