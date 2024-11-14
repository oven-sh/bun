//#FILE: test-zlib-convenience-methods.js
//#SHA1: e215a52650eaa95999dbb7d77f5b03376cdc673b
//-----------------
"use strict";

const zlib = require("zlib");
const util = require("util");
const { getBufferSources } = require("../common");

// Must be a multiple of 4 characters in total to test all ArrayBufferView
// types.
const expectStr = "blah".repeat(8);
const expectBuf = Buffer.from(expectStr);

const opts = {
  level: 9,
  chunkSize: 1024,
};

const optsInfo = {
  info: true,
};

const methodPairs = [
  ["gzip", "gunzip", "Gzip", "Gunzip"],
  ["gzip", "unzip", "Gzip", "Unzip"],
  ["deflate", "inflate", "Deflate", "Inflate"],
  ["deflateRaw", "inflateRaw", "DeflateRaw", "InflateRaw"],
  ["brotliCompress", "brotliDecompress", "BrotliCompress", "BrotliDecompress"],
];

const testCases = [
  ["string", expectStr],
  ["Buffer", expectBuf],
  ...getBufferSources(expectBuf).map(obj => [obj[Symbol.toStringTag], obj]),
];

describe("zlib convenience methods", () => {
  describe.each(testCases)("%s input", (type, expected) => {
    for (const [compress, decompress, CompressClass, DecompressClass] of methodPairs) {
      describe(`${compress}/${decompress}`, async () => {
        test("Async with options", async () => {
          const c = await util.promisify(zlib[compress])(expected, opts);
          const d = await util.promisify(zlib[decompress])(c, opts);
          expect(d.toString()).toEqual(expectStr);
        });

        test("Async without options", async () => {
          const c = await util.promisify(zlib[compress])(expected);
          const d = await util.promisify(zlib[decompress])(c);
          expect(d.toString()).toEqual(expectStr);
        });

        test("Async with info option", async () => {
          const c = await util.promisify(zlib[compress])(expected, optsInfo);
          expect(c.engine).toBeInstanceOf(zlib[CompressClass]);
          const d = await util.promisify(zlib[decompress])(c.buffer, optsInfo);
          expect(d.engine).toBeInstanceOf(zlib[DecompressClass]);
          expect(d.buffer.toString()).toEqual(expectStr);
        });

        test("Sync with options", () => {
          const c = zlib[compress + "Sync"](expected, opts);
          const d = zlib[decompress + "Sync"](c, opts);
          expect(d.toString()).toEqual(expectStr);
        });

        test("Sync without options", async () => {
          const c = zlib[compress + "Sync"](expected);
          const d = zlib[decompress + "Sync"](c);
          expect(d.toString()).toEqual(expectStr);
        });

        test("Sync with info option", () => {
          const c = zlib[compress + "Sync"](expected, optsInfo);
          expect(c.engine).toBeInstanceOf(zlib[CompressClass]);
          const d = zlib[decompress + "Sync"](c.buffer, optsInfo);
          expect(d.engine).toBeInstanceOf(zlib[DecompressClass]);
          expect(d.buffer.toString()).toEqual(expectStr);
        });
      });
    }
  });

  test("throws error when callback is not provided", () => {
    expect(() => zlib.gzip("abc")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.stringContaining('The "callback" argument must be of type function'),
      }),
    );
  });
});

//<#END_FILE: test-zlib-convenience-methods.js
