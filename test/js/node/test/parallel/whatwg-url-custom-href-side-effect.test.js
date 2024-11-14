//#FILE: test-whatwg-url-custom-href-side-effect.js
//#SHA1: c2abb976ed209d25f38bb1ff1e7d8c2110ee51d4
//-----------------
"use strict";

// Tests below are not from WPT.

test("URL href assignment side effect", () => {
  const ref = new URL("http://example.com/path");
  const url = new URL("http://example.com/path");

  expect(() => {
    url.href = "";
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(url).toEqual(ref);
});

//<#END_FILE: test-whatwg-url-custom-href-side-effect.js
