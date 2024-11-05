//#FILE: test-zlib-destroy-pipe.js
//#SHA1: 55e5ddd18c87bc58f331f82caa482cd49f5de168
//-----------------
"use strict";

const zlib = require("zlib");
const { Writable } = require("stream");

test("verify that the zlib transform does not error in case it is destroyed with data still in flight", () => {
  const ts = zlib.createGzip();

  const ws = new Writable({
    write(chunk, enc, cb) {
      setImmediate(cb);
      ts.destroy();
    },
  });

  const buf = Buffer.allocUnsafe(1024 * 1024 * 20);
  ts.end(buf);
  ts.pipe(ws);
});

//<#END_FILE: test-zlib-destroy-pipe.js
