//#FILE: test-zlib-invalid-arg-value-brotli-compress.js
//#SHA1: fab88f892e21351603b5ae7227837d01149bdae6
//-----------------
"use strict";

// This test ensures that the BrotliCompress function throws
// ERR_INVALID_ARG_TYPE when the values of the `params` key-value object are
// neither numbers nor booleans.

const { BrotliCompress, constants } = require("zlib");

test("BrotliCompress throws ERR_INVALID_ARG_TYPE for invalid params value", () => {
  const opts = {
    params: {
      [constants.BROTLI_PARAM_MODE]: "lol",
    },
  };

  expect(() => BrotliCompress(opts)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-zlib-invalid-arg-value-brotli-compress.js
