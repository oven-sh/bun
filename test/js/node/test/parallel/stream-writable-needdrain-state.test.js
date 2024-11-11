//#FILE: test-stream-writable-needdrain-state.js
//#SHA1: c73d65b940e3ea2fe9c94d9c9d0d4ffe36c47397
//-----------------
'use strict';

const stream = require('stream');

test('Stream writable needDrain state', (done) => {
  const transform = new stream.Transform({
    transform: _transform,
    highWaterMark: 1
  });

  function _transform(chunk, encoding, cb) {
    process.nextTick(() => {
      expect(transform._writableState.needDrain).toBe(true);
      cb();
    });
  }

  expect(transform._writableState.needDrain).toBe(false);

  const writeCallback = jest.fn(() => {
    expect(transform._writableState.needDrain).toBe(false);
    done();
  });

  transform.write('asdasd', writeCallback);

  expect(transform._writableState.needDrain).toBe(true);
  expect(writeCallback).toHaveBeenCalledTimes(0);
});

//<#END_FILE: test-stream-writable-needdrain-state.js
