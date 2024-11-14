//#FILE: test-zlib-brotli-kmaxlength-rangeerror.js
//#SHA1: f0d3ad25e8a844b31b7e14ab68a84182fd5f52b7
//-----------------
"use strict";

const util = require("util");

// Change kMaxLength for zlib to trigger the error without having to allocate large Buffers.
const buffer = require("buffer");
const oldkMaxLength = buffer.kMaxLength;
buffer.kMaxLength = 64;
const zlib = require("zlib");
buffer.kMaxLength = oldkMaxLength;

// Create a large input buffer
const encoded = Buffer.from("G38A+CXCIrFAIAM=", "base64");

test("brotliDecompress throws RangeError for large output (async)", async () => {
  await expect(async () => util.promisify(zlib.brotliDecompress)(encoded)).toThrowWithCodeAsync(
    RangeError,
    "ERR_BUFFER_TOO_LARGE",
  );
}, 1000);

test("brotliDecompressSync throws RangeError for large output", () => {
  expect(() => zlib.brotliDecompressSync(encoded)).toThrowWithCode(RangeError, "ERR_BUFFER_TOO_LARGE");
});

//<#END_FILE: test-zlib-brotli-kmaxlength-rangeerror.js
