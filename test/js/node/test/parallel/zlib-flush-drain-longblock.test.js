//#FILE: test-zlib-flush-drain-longblock.js
//#SHA1: 95927f13fbb59e0a8a2a32c14d0443fc110bab6e
//-----------------
"use strict";

const zlib = require("zlib");

test("zlib flush interacts properly with writableState.needDrain", done => {
  const zipper = zlib.createGzip({ highWaterMark: 16384 });
  const unzipper = zlib.createGunzip();
  zipper.pipe(unzipper);

  zipper.write("A".repeat(17000));
  zipper.flush();

  let received = 0;
  let dataCallCount = 0;

  unzipper.on("data", d => {
    received += d.length;
    dataCallCount++;
  });

  unzipper.on("end", () => {
    expect(received).toBe(17000);
    expect(dataCallCount).toBeGreaterThanOrEqual(2);
    done();
  });

  // Properly end the streams to ensure all data is processed
  zipper.end();
});

//<#END_FILE: test-zlib-flush-drain-longblock.js
