//#FILE: test-zlib-not-string-or-buffer.js
//#SHA1: d07db97d9393df2ab9453800ae80f2921d93b6e2
//-----------------
"use strict";

// Check the error condition testing for passing something other than a string
// or buffer.

const zlib = require("zlib");

test("zlib.deflateSync throws for invalid input types", () => {
  const invalidInputs = [undefined, null, true, false, 0, 1, [1, 2, 3], { foo: "bar" }];

  invalidInputs.forEach(input => {
    expect(() => zlib.deflateSync(input)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringContaining(
          'The "buffer" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer.',
        ),
      }),
    );
  });
});

//<#END_FILE: test-zlib-not-string-or-buffer.js
