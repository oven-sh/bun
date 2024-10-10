//#FILE: test-buffer-set-inspect-max-bytes.js
//#SHA1: de73b2a241585e1cf17a057d21cdbabbadf963bb
//-----------------
"use strict";

const buffer = require("buffer");

describe("buffer.INSPECT_MAX_BYTES", () => {
  const rangeErrorObjs = [NaN, -1];
  const typeErrorObj = "and even this";

  test.each(rangeErrorObjs)("throws RangeError for invalid value: %p", obj => {
    expect(() => {
      buffer.INSPECT_MAX_BYTES = obj;
    }).toThrow(
      expect.objectContaining({
        code: "ERR_OUT_OF_RANGE",
        name: "RangeError",
        message: expect.any(String),
      }),
    );
  });

  test("throws TypeError for invalid type", () => {
    expect(() => {
      buffer.INSPECT_MAX_BYTES = typeErrorObj;
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-buffer-set-inspect-max-bytes.js
