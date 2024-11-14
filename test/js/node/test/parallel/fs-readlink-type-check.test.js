//#FILE: test-fs-readlink-type-check.js
//#SHA1: dd36bda8e12e6c22c342325345dd8d1de2097d9c
//-----------------
"use strict";

const fs = require("fs");

[false, 1, {}, [], null, undefined].forEach(i => {
  test(`fs.readlink throws for invalid input: ${JSON.stringify(i)}`, () => {
    expect(() => fs.readlink(i, jest.fn())).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });

  test(`fs.readlinkSync throws for invalid input: ${JSON.stringify(i)}`, () => {
    expect(() => fs.readlinkSync(i)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-fs-readlink-type-check.js
