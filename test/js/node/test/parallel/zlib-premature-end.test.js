//#FILE: test-zlib-premature-end.js
//#SHA1: f44e08e4886032467eb9cf64412c7eda2b575a16
//-----------------
"use strict";
const zlib = require("zlib");

const input = "0123456789".repeat(4);

const testCases = [
  [zlib.deflateRawSync, zlib.createInflateRaw],
  [zlib.deflateSync, zlib.createInflate],
  [zlib.brotliCompressSync, zlib.createBrotliDecompress],
];

const variants = [
  (stream, compressed, trailingData) => {
    stream.end(compressed);
  },
  (stream, compressed, trailingData) => {
    stream.write(compressed);
    stream.write(trailingData);
  },
  (stream, compressed, trailingData) => {
    stream.write(compressed);
    stream.end(trailingData);
  },
  (stream, compressed, trailingData) => {
    stream.write(Buffer.concat([compressed, trailingData]));
  },
  (stream, compressed, trailingData) => {
    stream.end(Buffer.concat([compressed, trailingData]));
  },
];

describe("zlib premature end tests", () => {
  testCases.forEach(([compress, decompressor]) => {
    describe(`${compress.name} and ${decompressor.name}`, () => {
      const compressed = compress(input);
      const trailingData = Buffer.from("not valid compressed data");

      variants.forEach((variant, index) => {
        test(`variant ${index + 1}`, done => {
          let output = "";
          const stream = decompressor();
          stream.setEncoding("utf8");
          stream.on("data", chunk => (output += chunk));
          stream.on("end", () => {
            expect(output).toBe(input);
            expect(stream.bytesWritten).toBe(compressed.length);
            done();
          });
          variant(stream, compressed, trailingData);
        });
      });
    });
  });
});

//<#END_FILE: test-zlib-premature-end.js
