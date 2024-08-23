//#FILE: test-whatwg-encoding-custom-api-basics.js
//#SHA1: 8181a892b0d1e5885b29b1165631875e587b7700
//-----------------
"use strict";

// From: https://github.com/w3c/web-platform-tests/blob/master/encoding/api-basics.html
// This is the part that can be run without ICU

function testDecodeSample(encoding, string, bytes) {
  expect(new TextDecoder(encoding).decode(new Uint8Array(bytes))).toBe(string);
  expect(new TextDecoder(encoding).decode(new Uint8Array(bytes).buffer)).toBe(string);
}

// `z` (ASCII U+007A), cent (Latin-1 U+00A2), CJK water (BMP U+6C34),
// G-Clef (non-BMP U+1D11E), PUA (BMP U+F8FF), PUA (non-BMP U+10FFFD)
// byte-swapped BOM (non-character U+FFFE)
const sample = "z\xA2\u6C34\uD834\uDD1E\uF8FF\uDBFF\uDFFD\uFFFE";

test("utf-8 encoding and decoding", () => {
  const encoding = "utf-8";
  const string = sample;
  const bytes = [
    0x7a, 0xc2, 0xa2, 0xe6, 0xb0, 0xb4, 0xf0, 0x9d, 0x84, 0x9e, 0xef, 0xa3, 0xbf, 0xf4, 0x8f, 0xbf, 0xbd, 0xef, 0xbf,
    0xbe,
  ];
  const encoded = new TextEncoder().encode(string);
  expect([...encoded]).toEqual(bytes);
  expect(new TextDecoder(encoding).decode(new Uint8Array(bytes))).toBe(string);
  expect(new TextDecoder(encoding).decode(new Uint8Array(bytes).buffer)).toBe(string);
});

test("utf-16le decoding", () => {
  testDecodeSample(
    "utf-16le",
    sample,
    [0x7a, 0x00, 0xa2, 0x00, 0x34, 0x6c, 0x34, 0xd8, 0x1e, 0xdd, 0xff, 0xf8, 0xff, 0xdb, 0xfd, 0xdf, 0xfe, 0xff],
  );
});

test("utf-16 decoding", () => {
  testDecodeSample(
    "utf-16",
    sample,
    [0x7a, 0x00, 0xa2, 0x00, 0x34, 0x6c, 0x34, 0xd8, 0x1e, 0xdd, 0xff, 0xf8, 0xff, 0xdb, 0xfd, 0xdf, 0xfe, 0xff],
  );
});

//<#END_FILE: test-whatwg-encoding-custom-api-basics.js
