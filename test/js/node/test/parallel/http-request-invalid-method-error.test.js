//#FILE: test-http-request-invalid-method-error.js
//#SHA1: a862bddcd8e00cd71afecf9785e9bf5f16a846fe
//-----------------
"use strict";

const http = require("http");

test("http.request throws error for invalid method", () => {
  expect(() => http.request({ method: "\0" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_HTTP_TOKEN",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-http-request-invalid-method-error.js
