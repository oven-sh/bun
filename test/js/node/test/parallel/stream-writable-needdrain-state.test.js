//#FILE: test-stream-writable-needdrain-state.js
//#SHA1: c73d65b940e3ea2fe9c94d9c9d0d4ffe36c47397
//-----------------
"use strict";

const stream = require("stream");

test("Transform stream needDrain state", done => {
  const transform = new stream.Transform({
    transform: _transform,
    highWaterMark: 1,
  });

  function _transform(chunk, encoding, cb) {
    process.nextTick(() => {
      expect(transform._writableState.needDrain).toBe(true);
      cb();
    });
  }

  expect(transform._writableState.needDrain).toBe(false);

  transform.write("asdasd", () => {
    expect(transform._writableState.needDrain).toBe(false);
    done();
  });

  expect(transform._writableState.needDrain).toBe(true);
});

//<#END_FILE: test-stream-writable-needdrain-state.js
