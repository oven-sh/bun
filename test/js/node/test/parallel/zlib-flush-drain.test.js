//#FILE: test-zlib-flush-drain.js
//#SHA1: 2f83bee63a56543c9824833e4fa7d8f5b33a373e
//-----------------
"use strict";
const zlib = require("zlib");

const bigData = Buffer.alloc(10240, "x");

const opts = {
  level: 0,
  highWaterMark: 16,
};

let flushCount = 0;
let drainCount = 0;
let beforeFlush, afterFlush;

test("zlib flush and drain behavior", done => {
  const deflater = zlib.createDeflate(opts);

  // Shim deflater.flush so we can count times executed
  const flush = deflater.flush;
  deflater.flush = function (kind, callback) {
    flushCount++;
    flush.call(this, kind, callback);
  };

  deflater.write(bigData);

  const ws = deflater._writableState;
  beforeFlush = ws.needDrain;

  deflater.on("data", () => {});

  deflater.flush(function (err) {
    afterFlush = ws.needDrain;
  });

  deflater.on("drain", function () {
    drainCount++;
  });

  // Use setTimeout to ensure all asynchronous operations have completed
  setTimeout(() => {
    expect(beforeFlush).toBe(true);
    expect(afterFlush).toBe(false);
    expect(drainCount).toBe(1);
    expect(flushCount).toBe(1);
    done();
  }, 100);
});

//<#END_FILE: test-zlib-flush-drain.js
