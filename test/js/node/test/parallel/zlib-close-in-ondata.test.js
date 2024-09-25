//#FILE: test-zlib-close-in-ondata.js
//#SHA1: 8218c0461dd0733882aaf37688e3b32b164e3535
//-----------------
"use strict";

const zlib = require("zlib");

test("zlib stream closes in ondata event", done => {
  const ts = zlib.createGzip();
  const buf = Buffer.alloc(1024 * 1024 * 20);

  ts.on(
    "data",
    jest.fn(() => {
      ts.close();
      done();
    }),
  );

  ts.end(buf);
});

//<#END_FILE: test-zlib-close-in-ondata.js
