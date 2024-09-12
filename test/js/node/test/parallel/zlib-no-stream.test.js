//#FILE: test-zlib-no-stream.js
//#SHA1: 5755924e9363a20243c326747623e8e266f81625
//-----------------
/* eslint-disable node-core/required-modules */
/* eslint-disable node-core/require-common-first */

"use strict";

// We are not loading common because it will load the stream module,
// defeating the purpose of this test.

const { gzipSync } = require("zlib");

// Avoid regressions such as https://github.com/nodejs/node/issues/36615

test("gzipSync should not throw", () => {
  // This must not throw
  expect(() => gzipSync("fooobar")).not.toThrow();
});

//<#END_FILE: test-zlib-no-stream.js
