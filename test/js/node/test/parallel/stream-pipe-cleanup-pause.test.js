//#FILE: test-stream-pipe-cleanup-pause.js
//#SHA1: b50925d80481a8bfd785f2ac6ab7726ef104aa14
//-----------------
'use strict';
const stream = require('stream');

test('stream pipe cleanup and pause', (done) => {
  const reader = new stream.Readable();
  const writer1 = new stream.Writable();
  const writer2 = new stream.Writable();

  // 560000 is chosen here because it is larger than the (default) highWaterMark
  // and will cause `.write()` to return false
  // See: https://github.com/nodejs/node/issues/2323
  const buffer = Buffer.allocUnsafe(560000);

  reader._read = jest.fn();

  writer1._write = jest.fn((chunk, encoding, cb) => {
    writer1.emit('chunk-received');
    cb();
  });

  writer2._write = jest.fn((chunk, encoding, cb) => {
    cb();
  });

  writer1.once('chunk-received', () => {
    reader.unpipe(writer1);
    reader.pipe(writer2);
    reader.push(buffer);
    setImmediate(() => {
      reader.push(buffer);
      setImmediate(() => {
        reader.push(buffer);
        // After pushing the last buffer, wait a bit before checking
        setTimeout(checkResults, 100);
      });
    });
  });

  function checkResults() {
    expect(writer1._write).toHaveBeenCalledTimes(1);
    expect(writer2._write).toHaveBeenCalledTimes(3);
    done();
  }

  reader.pipe(writer1);
  reader.push(buffer);
}, 10000);  // Increase timeout to 10 seconds

//<#END_FILE: test-stream-pipe-cleanup-pause.js
