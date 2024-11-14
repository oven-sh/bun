//#FILE: test-zlib-deflate-constructors.js
//#SHA1: fdacb219f8fcceeeb4800473b37fca16fcf4c241
//-----------------
"use strict";

const zlib = require("zlib");

// Work with and without `new` keyword
test("Deflate constructor works with and without new keyword", () => {
  expect(zlib.Deflate()).toBeInstanceOf(zlib.Deflate);
  expect(new zlib.Deflate()).toBeInstanceOf(zlib.Deflate);
});

test("DeflateRaw constructor works with and without new keyword", () => {
  expect(zlib.DeflateRaw()).toBeInstanceOf(zlib.DeflateRaw);
  expect(new zlib.DeflateRaw()).toBeInstanceOf(zlib.DeflateRaw);
});

// Throws if `options.chunkSize` is invalid
test("Deflate constructor throws for invalid chunkSize", () => {
  expect(() => new zlib.Deflate({ chunkSize: "test" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ chunkSize: -Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ chunkSize: 0 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

// Confirm that maximum chunk size cannot be exceeded because it is `Infinity`.
test("Z_MAX_CHUNK is Infinity", () => {
  expect(zlib.constants.Z_MAX_CHUNK).toBe(Infinity);
});

// Throws if `options.windowBits` is invalid
test("Deflate constructor throws for invalid windowBits", () => {
  expect(() => new zlib.Deflate({ windowBits: "test" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ windowBits: -Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ windowBits: Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ windowBits: 0 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

// Throws if `options.level` is invalid
test("Deflate constructor throws for invalid level", () => {
  expect(() => new zlib.Deflate({ level: "test" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ level: -Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ level: Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ level: -2 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

// Throws if `level` invalid in  `Deflate.prototype.params()`
test("Deflate.prototype.params throws for invalid level", () => {
  expect(() => new zlib.Deflate().params("test")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate().params(-Infinity)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate().params(Infinity)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate().params(-2)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

// Throws if options.memLevel is invalid
test("Deflate constructor throws for invalid memLevel", () => {
  expect(() => new zlib.Deflate({ memLevel: "test" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ memLevel: -Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ memLevel: Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ memLevel: -2 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

// Does not throw if opts.strategy is valid
test("Deflate constructor does not throw for valid strategy", () => {
  expect(() => new zlib.Deflate({ strategy: zlib.constants.Z_FILTERED })).not.toThrow();
  expect(() => new zlib.Deflate({ strategy: zlib.constants.Z_HUFFMAN_ONLY })).not.toThrow();
  expect(() => new zlib.Deflate({ strategy: zlib.constants.Z_RLE })).not.toThrow();
  expect(() => new zlib.Deflate({ strategy: zlib.constants.Z_FIXED })).not.toThrow();
  expect(() => new zlib.Deflate({ strategy: zlib.constants.Z_DEFAULT_STRATEGY })).not.toThrow();
});

// Throws if options.strategy is invalid
test("Deflate constructor throws for invalid strategy", () => {
  expect(() => new zlib.Deflate({ strategy: "test" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ strategy: -Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ strategy: Infinity })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate({ strategy: -2 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

// Throws TypeError if `strategy` is invalid in `Deflate.prototype.params()`
test("Deflate.prototype.params throws for invalid strategy", () => {
  expect(() => new zlib.Deflate().params(0, "test")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate().params(0, -Infinity)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate().params(0, Infinity)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => new zlib.Deflate().params(0, -2)).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

// Throws if opts.dictionary is not a Buffer
test("Deflate constructor throws if dictionary is not a Buffer", () => {
  expect(() => new zlib.Deflate({ dictionary: "not a buffer" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-zlib-deflate-constructors.js
