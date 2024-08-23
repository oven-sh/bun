//#FILE: test-zlib-unzip-one-byte-chunks.js
//#SHA1: 3c242140501ae0e8e9277c68696c231a04070018
//-----------------
"use strict";
const zlib = require("zlib");

test("zlib unzip one byte chunks", done => {
  const data = Buffer.concat([zlib.gzipSync("abc"), zlib.gzipSync("def")]);

  const resultBuffers = [];

  const unzip = zlib
    .createUnzip()
    .on("error", err => {
      expect(err).toBeFalsy();
    })
    .on("data", data => resultBuffers.push(data))
    .on("finish", () => {
      const unzipped = Buffer.concat(resultBuffers).toString();
      expect(unzipped).toBe("abcdef");
      done();
    });

  for (let i = 0; i < data.length; i++) {
    // Write each single byte individually.
    unzip.write(Buffer.from([data[i]]));
  }

  unzip.end();
});

//<#END_FILE: test-zlib-unzip-one-byte-chunks.js
