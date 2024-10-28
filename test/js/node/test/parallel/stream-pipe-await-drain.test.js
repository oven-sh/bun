//#FILE: test-stream-pipe-await-drain.js
//#SHA1: e63f744dbe2143bc6da8de0acc6a4a72526a1588
//-----------------
'use strict';
const stream = require('stream');

// This is very similar to test-stream-pipe-cleanup-pause.js.

// 560000 is chosen here because it is larger than the (default) highWaterMark
// and will cause `.write()` to return false
// See: https://github.com/nodejs/node/issues/5820
const buffer = Buffer.allocUnsafe(560000);

test('Stream pipe await drain', (done) => {
  const reader = new stream.Readable();
  const writer1 = new stream.Writable();
  const writer2 = new stream.Writable();
  const writer3 = new stream.Writable();

  reader._read = () => {};

  const writer1WriteSpy = jest.fn((chunk, encoding, cb) => {
    writer1.emit('chunk-received');
    process.nextTick(cb);
  });
  writer1._write = writer1WriteSpy;

  writer1.once('chunk-received', () => {
    expect(reader._readableState.awaitDrainWriters.size).toBe(0);
    setImmediate(() => {
      // This one should *not* get through to writer1 because writer2 is not
      // "done" processing.
      reader.push(buffer);
    });
  });

  // A "slow" consumer:
  const writer2WriteSpy = jest.fn((chunk, encoding, cb) => {
    expect(reader._readableState.awaitDrainWriters.size).toBe(1);
    // Not calling cb here to "simulate" slow stream.
  });
  writer2._write = writer2WriteSpy;

  const writer3WriteSpy = jest.fn((chunk, encoding, cb) => {
    expect(reader._readableState.awaitDrainWriters.size).toBe(2);
    // Not calling cb here to "simulate" slow stream.
  });
  writer3._write = writer3WriteSpy;

  reader.pipe(writer1);
  reader.pipe(writer2);
  reader.pipe(writer3);
  reader.push(buffer);

  // Use setTimeout to allow time for all operations to complete
  setTimeout(() => {
    expect(writer1WriteSpy).toHaveBeenCalledTimes(1);
    expect(writer2WriteSpy).toHaveBeenCalledTimes(1);
    expect(writer3WriteSpy).toHaveBeenCalledTimes(1);
    done();
  }, 100);
});

//<#END_FILE: test-stream-pipe-await-drain.js
