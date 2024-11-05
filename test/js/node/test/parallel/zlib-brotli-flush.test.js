//#FILE: test-zlib-brotli-flush.js
//#SHA1: b0a953be98db6dd674668bfd6cffa3e283144ad1
//-----------------
"use strict";
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const fixturesPath = path.join(__dirname, "..", "fixtures");
const file = fs.readFileSync(path.join(fixturesPath, "person.jpg"));
const chunkSize = 16;

test("BrotliCompress flush should produce expected output", done => {
  const deflater = new zlib.BrotliCompress();
  const chunk = file.slice(0, chunkSize);
  const expectedFull = Buffer.from("iweA/9j/4AAQSkZJRgABAQEASA==", "base64");
  let actualFull;

  deflater.write(chunk, () => {
    deflater.flush(() => {
      const bufs = [];
      let buf;
      while ((buf = deflater.read()) !== null) {
        bufs.push(buf);
      }
      actualFull = Buffer.concat(bufs);
      expect(actualFull).toEqual(expectedFull);
      done();
    });
  });
});

//<#END_FILE: test-zlib-brotli-flush.js
