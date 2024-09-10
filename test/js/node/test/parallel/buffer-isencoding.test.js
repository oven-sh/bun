//#FILE: test-buffer-isencoding.js
//#SHA1: 438625bd1ca2a23aa8716bea5334f3ac07eb040f
//-----------------
"use strict";

describe("Buffer.isEncoding", () => {
  const validEncodings = [
    "hex",
    "utf8",
    "utf-8",
    "ascii",
    "latin1",
    "binary",
    "base64",
    "base64url",
    "ucs2",
    "ucs-2",
    "utf16le",
    "utf-16le",
  ];

  validEncodings.forEach(enc => {
    test(`should return true for valid encodings: ${enc}`, () => {
      expect(Buffer.isEncoding(enc)).toBe(true);
    });
  });

  const invalidEncodings = ["utf9", "utf-7", "Unicode-FTW", "new gnu gun", false, NaN, {}, Infinity, [], 1, 0, -1, ""];

  invalidEncodings.forEach(enc => {
    test(`should return false for invalid encodings: ${JSON.stringify(enc)}`, () => {
      expect(Buffer.isEncoding(enc)).toBe(false);
    });
  });
});

//<#END_FILE: test-buffer-isencoding.js
