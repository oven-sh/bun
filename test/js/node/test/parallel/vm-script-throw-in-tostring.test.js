//#FILE: test-vm-script-throw-in-tostring.js
//#SHA1: 16675c8942dbb81a032c117fa42c9611cda082e0
//-----------------
"use strict";

const vm = require("vm");

test("vm.Script throws when toString throws", () => {
  expect(() => {
    new vm.Script({
      toString() {
        throw new Error();
      },
    });
  }).toThrow(
    expect.objectContaining({
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-vm-script-throw-in-tostring.js
