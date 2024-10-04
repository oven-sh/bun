//#FILE: test-zlib-flush-flags.js
//#SHA1: 9fb4201163deb1a6dc1f74c5c7a2723ec1a9d342
//-----------------
"use strict";

const zlib = require("zlib");

test("createGzip with valid flush option", () => {
  expect(() => zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH })).not.toThrow();
});

test("createGzip with invalid flush option type", () => {
  expect(() => zlib.createGzip({ flush: "foobar" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

test("createGzip with out of range flush option", () => {
  expect(() => zlib.createGzip({ flush: 10000 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

test("createGzip with valid finishFlush option", () => {
  expect(() => zlib.createGzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH })).not.toThrow();
});

test("createGzip with invalid finishFlush option type", () => {
  expect(() => zlib.createGzip({ finishFlush: "foobar" })).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

test("createGzip with out of range finishFlush option", () => {
  expect(() => zlib.createGzip({ finishFlush: 10000 })).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-zlib-flush-flags.js
