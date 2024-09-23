//#FILE: test-stream-write-drain.js
//#SHA1: 893708699284e105a409388953fae28a836370b2
//-----------------
"use strict";
const { Writable } = require("stream");

// Don't emit 'drain' if ended

test("Writable stream should not emit 'drain' if ended", done => {
  const w = new Writable({
    write(data, enc, cb) {
      process.nextTick(cb);
    },
    highWaterMark: 1,
  });

  const drainSpy = jest.fn();
  w.on("drain", drainSpy);

  w.write("asd");
  w.end();

  // Use process.nextTick to ensure that any potential 'drain' event would have been emitted
  process.nextTick(() => {
    expect(drainSpy).not.toHaveBeenCalled();
    done();
  });
});

//<#END_FILE: test-stream-write-drain.js
