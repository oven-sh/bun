//#FILE: test-whatwg-url-custom-searchparams-stringifier.js
//#SHA1: 588663b1cad21e26a4b8e25c0659d204a5d96542
//-----------------
"use strict";

// Tests below are not from WPT.

test("URLSearchParams toString called with invalid this", () => {
  const params = new URLSearchParams();
  expect(() => {
    params.toString.call(undefined);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_THIS",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

// The URLSearchParams stringifier mutates the base URL using
// different percent-encoding rules than the URL itself.
test("URLSearchParams stringifier mutates base URL with different percent-encoding", () => {
  const myUrl = new URL("https://example.org?foo=~bar");
  expect(myUrl.search).toBe("?foo=~bar");
  myUrl.searchParams.sort();
  expect(myUrl.search).toBe("?foo=%7Ebar");
});

//<#END_FILE: test-whatwg-url-custom-searchparams-stringifier.js
