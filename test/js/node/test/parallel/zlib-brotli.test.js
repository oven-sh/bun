//#FILE: test-zlib-brotli.js
//#SHA1: 53d893f351dd67279a8561e244183e38864c0c92
//-----------------
"use strict";

const fixtures = require("../common/fixtures");
const zlib = require("zlib");

// Test some brotli-specific properties of the brotli streams that can not
// be easily covered through expanding zlib-only tests.

const sampleBuffer = fixtures.readSync("/pss-vectors.json");

test("Quality parameter at stream creation", () => {
  const sizes = [];
  for (let quality = zlib.constants.BROTLI_MIN_QUALITY; quality <= zlib.constants.BROTLI_MAX_QUALITY; quality++) {
    const encoded = zlib.brotliCompressSync(sampleBuffer, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      },
    });
    sizes.push(encoded.length);
  }

  // Increasing quality should roughly correspond to decreasing compressed size:
  for (let i = 0; i < sizes.length - 1; i++) {
    expect(sizes[i + 1]).toBeLessThanOrEqual(sizes[i] * 1.05); // 5 % margin of error.
  }
  expect(sizes[0]).toBeGreaterThan(sizes[sizes.length - 1]);
});

test("Setting out-of-bounds option values or keys", () => {
  // expect(() => {
  //   zlib.createBrotliCompress({
  //     params: {
  //       10000: 0,
  //     },
  //   });
  // }).toThrow(
  //   expect.objectContaining({
  //     code: "ERR_BROTLI_INVALID_PARAM",
  //     name: "RangeError",
  //     message: expect.any(String),
  //   }),
  // );

  // Test that accidentally using duplicate keys fails.
  // expect(() => {
  //   zlib.createBrotliCompress({
  //     params: {
  //       0: 0,
  //       "00": 0,
  //     },
  //   });
  // }).toThrow(
  //   expect.objectContaining({
  //     code: "ERR_BROTLI_INVALID_PARAM",
  //     name: "RangeError",
  //     message: expect.any(String),
  //   }),
  // );

  expect(() => {
    zlib.createBrotliCompress({
      params: {
        // This is a boolean flag
        [zlib.constants.BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING]: 42,
      },
    });
  }).toThrow(
    expect.objectContaining({
      code: "ERR_ZLIB_INITIALIZATION_FAILED",
      name: "Error",
      message: expect.any(String),
    }),
  );
});

test("Options.flush range", () => {
  expect(() => {
    zlib.brotliCompressSync("", { flush: zlib.constants.Z_FINISH });
  }).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => {
    zlib.brotliCompressSync("", { finishFlush: zlib.constants.Z_FINISH });
  }).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-zlib-brotli.js
