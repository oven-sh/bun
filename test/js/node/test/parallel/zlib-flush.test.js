//#FILE: test-zlib-flush.js
//#SHA1: 61f325893c63c826c2a498bc52ef3401f9a5a542
//-----------------
"use strict";

const zlib = require("node:zlib");

test("zlib flush", async () => {
  const opts = { level: 0 };
  const deflater = zlib.createDeflate(opts);
  const chunk = Buffer.from("/9j/4AAQSkZJRgABAQEASA==", "base64");
  const expectedNone = Buffer.from([0x78, 0x01]);
  const blkhdr = Buffer.from([0x00, 0x10, 0x00, 0xef, 0xff]);
  const adler32 = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff]);
  const expectedFull = Buffer.concat([blkhdr, chunk, adler32]);
  let actualNone;
  let actualFull;

  await new Promise(resolve => {
    deflater.write(chunk, function () {
      deflater.flush(zlib.constants.Z_NO_FLUSH, function () {
        actualNone = deflater.read();
        deflater.flush(function () {
          const bufs = [];
          let buf;
          while ((buf = deflater.read()) !== null) bufs.push(buf);
          actualFull = Buffer.concat(bufs);
          resolve();
        });
      });
    });
  });

  expect(actualNone).toEqual(expectedNone);
  expect(actualFull).toEqual(expectedFull);
});

//<#END_FILE: test-zlib-flush.js
