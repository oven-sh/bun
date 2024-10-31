//#FILE: test-zlib-destroy.js
//#SHA1: b28cfad7c9e73659c624238b74dcc38146c94203
//-----------------
"use strict";

const zlib = require("zlib");

// Verify that the zlib transform does clean up
// the handle when calling destroy.

test("zlib transform cleans up handle on destroy", done => {
  const ts = zlib.createGzip();
  ts.destroy();
  expect(ts._handle).toBeNull();

  ts.on("close", () => {
    ts.close(() => {
      done();
    });
  });
});

test("error is only emitted once", done => {
  const decompress = zlib.createGunzip(15);

  let errorCount = 0;
  decompress.on("error", err => {
    errorCount++;
    decompress.close();

    // Ensure this callback is only called once
    expect(errorCount).toBe(1);
    done();
  });

  decompress.write("something invalid");
  decompress.destroy(new Error("asd"));
});

//<#END_FILE: test-zlib-destroy.js
