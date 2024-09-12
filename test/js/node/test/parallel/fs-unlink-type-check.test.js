//#FILE: test-fs-unlink-type-check.js
//#SHA1: 337e42f3b15589a7652c32c0a1c92292abf098d0
//-----------------
"use strict";

const fs = require("fs");

test("fs.unlink and fs.unlinkSync with invalid types", () => {
  const invalidTypes = [false, 1, {}, [], null, undefined];

  invalidTypes.forEach(invalidType => {
    expect(() => fs.unlink(invalidType, jest.fn())).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );

    expect(() => fs.unlinkSync(invalidType)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-fs-unlink-type-check.js
