//#FILE: test-zlib-empty-buffer.js
//#SHA1: 7a2e8687dcd6e4bd815aa22c2bbff08251d9d91a
//-----------------
"use strict";
const zlib = require("zlib");
const { inspect, promisify } = require("util");
const emptyBuffer = Buffer.alloc(0);

describe("zlib empty buffer", () => {
  const testCases = [
    [zlib.deflateRawSync, zlib.inflateRawSync, "raw sync"],
    [zlib.deflateSync, zlib.inflateSync, "deflate sync"],
    [zlib.gzipSync, zlib.gunzipSync, "gzip sync"],
    [zlib.brotliCompressSync, zlib.brotliDecompressSync, "br sync"],
    [promisify(zlib.deflateRaw), promisify(zlib.inflateRaw), "raw"],
    [promisify(zlib.deflate), promisify(zlib.inflate), "deflate"],
    [promisify(zlib.gzip), promisify(zlib.gunzip), "gzip"],
    [promisify(zlib.brotliCompress), promisify(zlib.brotliDecompress), "br"],
  ];

  test.each(testCases)("compresses and decompresses empty buffer using %s", async (compress, decompress, method) => {
    const compressed = await compress(emptyBuffer);
    const decompressed = await decompress(compressed);
    expect(decompressed).toStrictEqual(emptyBuffer);
  });
});

//<#END_FILE: test-zlib-empty-buffer.js
