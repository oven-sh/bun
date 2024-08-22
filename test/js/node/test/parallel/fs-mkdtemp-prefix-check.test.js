//#FILE: test-fs-mkdtemp-prefix-check.js
//#SHA1: f17d58f63200ae9b8c855b9def7da223fc5db531
//-----------------
"use strict";
const fs = require("fs");

const prefixValues = [undefined, null, 0, true, false, 1];

describe("fs.mkdtempSync prefix check", () => {
  test.each(prefixValues)("should throw for invalid prefix: %p", value => {
    expect(() => {
      fs.mkdtempSync(value, {});
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

describe("fs.mkdtemp prefix check", () => {
  test.each(prefixValues)("should throw for invalid prefix: %p", value => {
    expect(() => {
      fs.mkdtemp(value, jest.fn());
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-fs-mkdtemp-prefix-check.js
