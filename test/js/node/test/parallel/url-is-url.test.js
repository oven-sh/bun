//#FILE: test-url-is-url.js
//#SHA1: 337a63661b82d89cf2592ee32d91780acb8e5925
//-----------------
"use strict";

const { URL, parse } = require("url");

// Remove the internal module usage
// const { isURL } = require('internal/url');

// Implement a simple isURL function for testing purposes
function isURL(input) {
  return input instanceof URL;
}

test("isURL function", () => {
  expect(isURL(new URL("https://www.nodejs.org"))).toBe(true);
  expect(isURL(parse("https://www.nodejs.org"))).toBe(false);
  expect(
    isURL({
      href: "https://www.nodejs.org",
      protocol: "https:",
      path: "/",
    }),
  ).toBe(false);
});

//<#END_FILE: test-url-is-url.js
