//#FILE: test-zlib-maxOutputLength.js
//#SHA1: 807eb08c901d7476140bcb35b519518450bef3e6
//-----------------
"use strict";
const zlib = require("zlib");
const { promisify } = require("util");

const brotliDecompressAsync = promisify(zlib.brotliDecompress);

const encoded = Buffer.from("G38A+CXCIrFAIAM=", "base64");

describe("zlib.brotliDecompress with maxOutputLength", () => {
  test("Async: should throw ERR_BUFFER_TOO_LARGE when maxOutputLength is exceeded", async () => {
    await expect(brotliDecompressAsync(encoded, { maxOutputLength: 64 })).rejects.toThrow(
      expect.objectContaining({
        code: "ERR_BUFFER_TOO_LARGE",
        message: expect.stringContaining("Cannot create a Buffer larger than 64 bytes"),
      }),
    );
  });

  test("Sync: should throw ERR_BUFFER_TOO_LARGE when maxOutputLength is exceeded", () => {
    expect(() => {
      zlib.brotliDecompressSync(encoded, { maxOutputLength: 64 });
    }).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_BUFFER_TOO_LARGE",
        message: expect.stringContaining("Cannot create a Buffer larger than 64 bytes"),
      }),
    );
  });

  test("Async: should not throw error when maxOutputLength is sufficient", async () => {
    await brotliDecompressAsync(encoded, { maxOutputLength: 256 });
  });

  test("Sync: should not throw error when maxOutputLength is sufficient", () => {
    expect(() => {
      zlib.brotliDecompressSync(encoded, { maxOutputLength: 256 });
    }).not.toThrow();
  });
});

//<#END_FILE: test-zlib-maxOutputLength.js
