//#FILE: test-readable-large-hwm.js
//#SHA1: 1f1184c10e91262eb541830677abcd3e759d304e
//-----------------
"use strict";
const { Readable } = require("stream");

// Make sure that readable completes
// even when reading larger buffer.
test("readable completes when reading larger buffer", done => {
  const bufferSize = 10 * 1024 * 1024;
  let n = 0;
  const r = new Readable({
    read() {
      // Try to fill readable buffer piece by piece.
      r.push(Buffer.alloc(bufferSize / 10));

      if (n++ > 10) {
        r.push(null);
      }
    },
  });

  r.on("readable", () => {
    while (true) {
      const ret = r.read(bufferSize);
      if (ret === null) break;
    }
  });

  r.on("end", () => {
    done();
  });
});

//<#END_FILE: test-readable-large-hwm.js
