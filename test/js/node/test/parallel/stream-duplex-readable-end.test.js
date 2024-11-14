//#FILE: test-stream-duplex-readable-end.js
//#SHA1: 8cecff6703e081aeb94abe2b37332bc7aef28b1d
//-----------------
"use strict";

// https://github.com/nodejs/node/issues/35926
const stream = require("stream");

test("stream duplex readable end", done => {
  let loops = 5;

  const src = new stream.Readable({
    highWaterMark: 16 * 1024,
    read() {
      if (loops--) this.push(Buffer.alloc(20000));
    },
  });

  const dst = new stream.Transform({
    highWaterMark: 16 * 1024,
    transform(chunk, output, fn) {
      this.push(null);
      fn();
    },
  });

  src.pipe(dst);

  dst.on("data", () => {});
  dst.on("end", () => {
    expect(loops).toBe(3);
    expect(src.isPaused()).toBe(true);
    done();
  });
});

//<#END_FILE: test-stream-duplex-readable-end.js
