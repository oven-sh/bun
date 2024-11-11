//#FILE: test-stream-transform-hwm0.js
//#SHA1: 8cbbf34a07a9f21480e8f9a205f331c244266b0c
//-----------------
'use strict';

const { Transform } = require('stream');

test('Transform stream with highWaterMark 0', (done) => {
  const t = new Transform({
    objectMode: true,
    highWaterMark: 0,
    transform(chunk, enc, callback) {
      process.nextTick(() => callback(null, chunk, enc));
    }
  });

  expect(t.write(1)).toBe(false);

  t.on('drain', () => {
    expect(t.write(2)).toBe(false);
    t.end();
  });

  t.once('readable', () => {
    expect(t.read()).toBe(1);
    setImmediate(() => {
      expect(t.read()).toBeNull();
      t.once('readable', () => {
        expect(t.read()).toBe(2);
        done();
      });
    });
  });
});

//<#END_FILE: test-stream-transform-hwm0.js
