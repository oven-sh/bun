//#FILE: test-fs-rmdir-type-check.js
//#SHA1: 2a00191160af6f0f76a82dcaef31d13c9b223d3b
//-----------------
"use strict";

const fs = require("fs");

test("fs.rmdir and fs.rmdirSync with invalid arguments", () => {
  [false, 1, [], {}, null, undefined].forEach(i => {
    expect(() => fs.rmdir(i, jest.fn())).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );

    expect(() => fs.rmdirSync(i)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-fs-rmdir-type-check.js
