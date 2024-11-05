//#FILE: test-zlib-flush-write-sync-interleaved.js
//#SHA1: 35bfe36486f112686943448a115a586035455ba7
//-----------------
"use strict";
const { createGzip, createGunzip, Z_PARTIAL_FLUSH } = require("zlib");

// Verify that .flush() behaves like .write() in terms of ordering, e.g. in
// a sequence like .write() + .flush() + .write() + .flush() each .flush() call
// only affects the data written before it.
// Refs: https://github.com/nodejs/node/issues/28478

test("zlib flush and write ordering", done => {
  const compress = createGzip();
  const decompress = createGunzip();
  decompress.setEncoding("utf8");

  const events = [];
  const compressedChunks = [];

  for (const chunk of ["abc", "def", "ghi"]) {
    compress.write(chunk, () => events.push({ written: chunk }));
    compress.flush(Z_PARTIAL_FLUSH, () => {
      events.push("flushed");
      const chunk = compress.read();
      if (chunk !== null) compressedChunks.push(chunk);
    });
  }

  compress.end(() => {
    events.push("compress end");
    writeToDecompress();
  });

  function writeToDecompress() {
    // Write the compressed chunks to a decompressor, one by one, in order to
    // verify that the flushes actually worked.
    const chunk = compressedChunks.shift();
    if (chunk === undefined) {
      decompress.end();
      checkResults();
      return;
    }
    decompress.write(chunk, () => {
      events.push({ read: decompress.read() });
      writeToDecompress();
    });
  }

  function checkResults() {
    expect(events).toEqual([
      { written: "abc" },
      "flushed",
      { written: "def" },
      "flushed",
      { written: "ghi" },
      "flushed",
      "compress end",
      { read: "abc" },
      { read: "def" },
      { read: "ghi" },
    ]);
    done();
  }
});

//<#END_FILE: test-zlib-flush-write-sync-interleaved.js
