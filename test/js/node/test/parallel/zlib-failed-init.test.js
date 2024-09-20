//#FILE: test-zlib-failed-init.js
//#SHA1: a1c770e81c677ebefa0e5969e3441b28e63ab75a
//-----------------
"use strict";

const zlib = require("zlib");

test("zlib createGzip with invalid chunkSize", () => {
  expect(() => zlib.createGzip({ chunkSize: 0 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
    }),
  );
});

test("zlib createGzip with invalid windowBits", () => {
  expect(() => zlib.createGzip({ windowBits: 0 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
    }),
  );
});

test("zlib createGzip with invalid memLevel", () => {
  expect(() => zlib.createGzip({ memLevel: 0 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
    }),
  );
});

test("zlib createGzip with NaN level", () => {
  const stream = zlib.createGzip({ level: NaN });
  expect(stream._level).toBe(zlib.constants.Z_DEFAULT_COMPRESSION);
});

test("zlib createGzip with NaN strategy", () => {
  const stream = zlib.createGzip({ strategy: NaN });
  expect(stream._strategy).toBe(zlib.constants.Z_DEFAULT_STRATEGY);
});

//<#END_FILE: test-zlib-failed-init.js
