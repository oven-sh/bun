//#FILE: test-fs-chown-type-check.js
//#SHA1: 6ecbd3ae2da32793768e64e9252d749ddf36c85a
//-----------------
"use strict";

const fs = require("fs");

describe("fs.chown and fs.chownSync type checks", () => {
  test("invalid path argument", () => {
    [false, 1, {}, [], null, undefined].forEach(invalidPath => {
      expect(() => fs.chown(invalidPath, 1, 1, jest.fn())).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );

      expect(() => fs.chownSync(invalidPath, 1, 1)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );
    });
  });

  test("invalid uid or gid arguments", () => {
    [false, "test", {}, [], null, undefined].forEach(invalidId => {
      expect(() => fs.chown("not_a_file_that_exists", invalidId, 1, jest.fn())).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );

      expect(() => fs.chown("not_a_file_that_exists", 1, invalidId, jest.fn())).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );

      expect(() => fs.chownSync("not_a_file_that_exists", invalidId, 1)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );

      expect(() => fs.chownSync("not_a_file_that_exists", 1, invalidId)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
        }),
      );
    });
  });
});

//<#END_FILE: test-fs-chown-type-check.js
