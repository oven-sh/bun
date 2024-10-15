//#FILE: test-buffer-new.js
//#SHA1: 56270fc6342f4ac15433cce1e1b1252ac4dcbb98
//-----------------
"use strict";

test("Buffer constructor with invalid arguments", () => {
  expect(() => new Buffer(42, "utf8")).toThrow({
    code: "ERR_INVALID_ARG_TYPE",
    name: "TypeError",
    message: `The "string" argument must be of type string. Received 42`,
  });
});

//<#END_FILE: test-buffer-new.js
