//#FILE: test-querystring-multichar-separator.js
//#SHA1: 22b484432502e6f32fc4517ea91060b983c7be25
//-----------------
"use strict";

const qs = require("querystring");

function check(actual, expected) {
  expect(actual).not.toBeInstanceOf(Object);
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  Object.keys(expected).forEach(function (key) {
    expect(actual[key]).toEqual(expected[key]);
  });
}

test("qs.parse with multi-character separator", () => {
  check(qs.parse("foo=>bar&&bar=>baz", "&&", "=>"), { foo: "bar", bar: "baz" });
});

test("qs.stringify with multi-character separator", () => {
  check(qs.stringify({ foo: "bar", bar: "baz" }, "&&", "=>"), "foo=>bar&&bar=>baz");
});

test("qs.parse with different multi-character separators", () => {
  check(qs.parse("foo==>bar, bar==>baz", ", ", "==>"), { foo: "bar", bar: "baz" });
});

test("qs.stringify with different multi-character separators", () => {
  check(qs.stringify({ foo: "bar", bar: "baz" }, ", ", "==>"), "foo==>bar, bar==>baz");
});

//<#END_FILE: test-querystring-multichar-separator.js
