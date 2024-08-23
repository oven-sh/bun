//#FILE: test-url-revokeobjecturl.js
//#SHA1: 573bfad806102976807ad71fef71b079005d8bfa
//-----------------
"use strict";

// Test ensures that the function receives the url argument.

test("URL.revokeObjectURL() throws with missing argument", () => {
  expect(() => {
    URL.revokeObjectURL();
  }).toThrow(
    expect.objectContaining({
      code: "ERR_MISSING_ARGS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-url-revokeobjecturl.js
