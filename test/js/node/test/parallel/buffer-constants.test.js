//#FILE: test-buffer-constants.js
//#SHA1: a5818d34d1588306e48d574ec76b69b2ee4dc51c
//-----------------
"use strict";

const { kMaxLength, kStringMaxLength } = require("buffer");
const { MAX_LENGTH, MAX_STRING_LENGTH } = require("buffer").constants;

test("Buffer constants", () => {
  expect(typeof MAX_LENGTH).toBe("number");
  expect(typeof MAX_STRING_LENGTH).toBe("number");
  expect(MAX_STRING_LENGTH).toBeLessThanOrEqual(MAX_LENGTH);

  expect(() => " ".repeat(MAX_STRING_LENGTH + 1)).toThrow(
    expect.objectContaining({
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => " ".repeat(MAX_STRING_LENGTH)).not.toThrow();

  // Legacy values match:
  expect(kMaxLength).toBe(MAX_LENGTH);
  expect(kStringMaxLength).toBe(MAX_STRING_LENGTH);
});

//<#END_FILE: test-buffer-constants.js
