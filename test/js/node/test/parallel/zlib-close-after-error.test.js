//#FILE: test-zlib-close-after-error.js
//#SHA1: 1f561376d8af1a6b21f9f9abf6813a20cde33be6
//-----------------
"use strict";
// https://github.com/nodejs/node/issues/6034

const zlib = require("zlib");

test("zlib close after error", done => {
  const decompress = zlib.createGunzip(15);

  decompress.on("error", err => {
    expect(decompress._closed).toBe(true);
    decompress.close();
    done();
  });

  expect(decompress._closed).toBe(false);
  decompress.write("something invalid");
});

//<#END_FILE: test-zlib-close-after-error.js
