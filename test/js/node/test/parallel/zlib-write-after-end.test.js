//#FILE: test-zlib-write-after-end.js
//#SHA1: 0d11ed6c9992b52c81a45bdb3d6fe0db4ab2681a
//-----------------
"use strict";
const zlib = require("zlib");

// Regression test for https://github.com/nodejs/node/issues/30976
// Writes to a stream should finish even after the readable side has been ended.

test("zlib write after end", done => {
  const data = zlib.deflateRawSync("Welcome");

  const inflate = zlib.createInflateRaw();

  inflate.resume();

  const writeCallback = jest.fn();

  inflate.write(data, writeCallback);
  inflate.write(Buffer.from([0x00]), writeCallback);
  inflate.write(Buffer.from([0x00]), writeCallback);

  inflate.flush(() => {
    expect(writeCallback).toHaveBeenCalledTimes(3);
    done();
  });
});

//<#END_FILE: test-zlib-write-after-end.js
