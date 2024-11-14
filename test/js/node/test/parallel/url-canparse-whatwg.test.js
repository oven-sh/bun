//#FILE: test-url-canParse-whatwg.js
//#SHA1: e1170e8b8d0057443bfb307c64dbd27b204ac2f0
//-----------------
"use strict";

test("URL.canParse requires one argument", () => {
  expect(() => {
    URL.canParse();
  }).toThrow(
    expect.objectContaining({
      code: "ERR_MISSING_ARGS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

test("URL.canParse works with v8 fast api", () => {
  // This test is to ensure that the v8 fast api works.
  for (let i = 0; i < 1e5; i++) {
    expect(URL.canParse("https://www.example.com/path/?query=param#hash")).toBe(true);
  }
});

//<#END_FILE: test-url-canParse-whatwg.js
