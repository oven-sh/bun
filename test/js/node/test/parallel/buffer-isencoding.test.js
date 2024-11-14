//#FILE: test-buffer-isencoding.js
//#SHA1: 438625bd1ca2a23aa8716bea5334f3ac07eb040f
//-----------------
"use strict";

describe("Buffer.isEncoding", () => {
  describe("should return true for valid encodings", () => {
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

    for (const enc of validEncodings) {
      test(`${enc}`, () => {
        expect(Buffer.isEncoding(enc)).toBe(true);
      });
    }
  });

  describe("should return false for invalid encodings", () => {
    const invalidEncodings = ["utf9", "utf-7", "Unicode-FTW", "new gnu gun", false, NaN, {}, Infinity, [], 1, 0, -1];

    for (const enc of invalidEncodings) {
      test(`${enc}`, () => {
        expect(Buffer.isEncoding(enc)).toBe(false);
      });
    }
  });
});

//<#END_FILE: test-buffer-isencoding.js
