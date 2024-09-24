//#FILE: test-zlib-kmaxlength-rangeerror.js
//#SHA1: b6507dfb859656a2d5194153ddf45de79e0ef0ce
//-----------------
"use strict";

const util = require("util");

// Change kMaxLength for zlib to trigger the error without having to allocate large Buffers.
const buffer = require("buffer");
const oldkMaxLength = buffer.kMaxLength;
buffer.kMaxLength = 64;
const zlib = require("zlib");
buffer.kMaxLength = oldkMaxLength;

const encoded = Buffer.from("H4sIAAAAAAAAA0tMHFgAAIw2K/GAAAAA", "base64");

describe("ensure that zlib throws a RangeError if the final buffer needs to be larger than kMaxLength and concatenation fails", () => {
  test("sync", () => {
    expect(() => zlib.gunzipSync(encoded)).toThrowWithCode(RangeError, "ERR_BUFFER_TOO_LARGE");
  });

  test("async", async () => {
    await expect(async () => util.promisify(zlib.gunzip)(encoded)).toThrowWithCodeAsync(
      RangeError,
      "ERR_BUFFER_TOO_LARGE",
    );
  });
});

//<#END_FILE: test-zlib-kmaxlength-rangeerror.js
