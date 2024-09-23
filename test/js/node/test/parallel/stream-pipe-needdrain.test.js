//#FILE: test-stream-pipe-needDrain.js
//#SHA1: 5c524a253a770fcbb95365aea011a38a665c61da
//-----------------
"use strict";

const { Readable, Writable } = require("stream");

// Pipe should pause temporarily if writable needs drain.
test("Pipe pauses when writable needs drain", done => {
  const w = new Writable({
    write(buf, encoding, callback) {
      process.nextTick(callback);
    },
    highWaterMark: 1,
  });

  while (w.write("asd"));

  expect(w.writableNeedDrain).toBe(true);

  const r = new Readable({
    read() {
      this.push("asd");
      this.push(null);
    },
  });

  const pauseSpy = jest.fn();
  r.on("pause", pauseSpy);

  const endSpy = jest.fn().mockImplementation(() => {
    expect(pauseSpy).toHaveBeenCalledTimes(2);
    done();
  });
  r.on("end", endSpy);

  r.pipe(w);
});

//<#END_FILE: test-stream-pipe-needDrain.js
