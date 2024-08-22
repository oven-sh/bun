//#FILE: test-whatwg-encoding-custom-textdecoder-invalid-arg.js
//#SHA1: eaf5b5a330366828645f6a0be0dbd859cf9f1bda
//-----------------
"use strict";

// This tests that ERR_INVALID_ARG_TYPE are thrown when
// invalid arguments are passed to TextDecoder.

test("TextDecoder throws ERR_INVALID_ARG_TYPE for invalid input types", () => {
  const notArrayBufferViewExamples = [false, {}, 1, "", new Error()];
  notArrayBufferViewExamples.forEach(invalidInputType => {
    expect(() => {
      new TextDecoder(undefined, null).decode(invalidInputType);
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-whatwg-encoding-custom-textdecoder-invalid-arg.js
