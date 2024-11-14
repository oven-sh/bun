//#FILE: test-whatwg-url-custom-searchparams-foreach.js
//#SHA1: affe74306c7fdeb688aadc771c4d7d5b769fc236
//-----------------
"use strict";

// Tests below are not from WPT.

test('URLSearchParams.forEach called with invalid "this"', () => {
  const params = new URLSearchParams();
  expect(() => {
    params.forEach.call(undefined);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_THIS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-whatwg-url-custom-searchparams-foreach.js
