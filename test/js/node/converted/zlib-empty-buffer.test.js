//#FILE: test-zlib-empty-buffer.js
//#SHA1: 7a2e8687dcd6e4bd815aa22c2bbff08251d9d91a
//-----------------
'use strict';

const zlib = require('zlib');
const { inspect, promisify } = require('util');

const emptyBuffer = Buffer.alloc(0);

describe('Zlib Empty Buffer', () => {
  const testCases = [
    ['deflateRawSync', 'inflateRawSync', 'raw sync'],
    ['deflateSync', 'inflateSync', 'deflate sync'],
    ['gzipSync', 'gunzipSync', 'gzip sync'],
    ['brotliCompressSync', 'brotliDecompressSync', 'br sync'],
    ['deflateRaw', 'inflateRaw', 'raw'],
    ['deflate', 'inflate', 'deflate'],
    ['gzip', 'gunzip', 'gzip'],
    ['brotliCompress', 'brotliDecompress', 'br'],
  ];

  testCases.forEach(([compressMethod, decompressMethod, methodName]) => {
    test(`${methodName} compression and decompression`, async () => {
      const compress = methodName.includes('sync') 
        ? zlib[compressMethod]
        : promisify(zlib[compressMethod]);
      
      const decompress = methodName.includes('sync')
        ? zlib[decompressMethod]
        : promisify(zlib[decompressMethod]);

      const compressed = await compress(emptyBuffer);
      const decompressed = await decompress(compressed);

      expect(decompressed).toEqual(emptyBuffer);
    });
  });
});