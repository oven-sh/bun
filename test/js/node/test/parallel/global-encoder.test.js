//#FILE: test-global-encoder.js
//#SHA1: 7397937d3493488fc47e8ba6ba8fcb4f5bdd97fa
//-----------------
"use strict";

test("TextDecoder and TextEncoder are globally available", () => {
  const util = require("util");

  expect(TextDecoder).toBe(util.TextDecoder);
  expect(TextEncoder).toBe(util.TextEncoder);
});

//<#END_FILE: test-global-encoder.js
