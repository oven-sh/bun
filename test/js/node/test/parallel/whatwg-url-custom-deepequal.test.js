//#FILE: test-whatwg-url-custom-deepequal.js
//#SHA1: 57a28f56bb87a00fe2433fabebd4a85cb2da39d0
//-----------------
"use strict";
// This tests that the internal flags in URL objects are consistent, as manifest
// through assert libraries.
// See https://github.com/nodejs/node/issues/24211

// Tests below are not from WPT.

test("URL objects are deeply equal", () => {
  expect(new URL("./foo", "https://example.com/")).toEqual(new URL("https://example.com/foo"));

  expect(new URL("./foo", "https://user:pass@example.com/")).toEqual(new URL("https://user:pass@example.com/foo"));
});

//<#END_FILE: test-whatwg-url-custom-deepequal.js
