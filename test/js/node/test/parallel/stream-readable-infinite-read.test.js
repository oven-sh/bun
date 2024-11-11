//#FILE: test-stream-readable-infinite-read.js
//#SHA1: d7e4f0f11eb33e10e34472e6340544d4ae18e376
//-----------------
'use strict';

const { Readable } = require('stream');

test('Readable stream with infinite read', (done) => {
  const buf = Buffer.alloc(8192);

  const readMock = jest.fn(() => {
    readable.push(buf);
  });

  const readable = new Readable({
    highWaterMark: 16 * 1024,
    read: readMock
  });

  let i = 0;

  const readableListener = jest.fn(() => {
    if (i++ === 10) {
      // We will just terminate now.
      readable.removeListener('readable', readableListener);
      expect(readMock).toHaveBeenCalledTimes(31);
      expect(readableListener).toHaveBeenCalledTimes(11);
      done();
      return;
    }

    const data = readable.read();
    // TODO(mcollina): there is something odd in the highWaterMark logic
    // investigate.
    if (i === 1) {
      expect(data.length).toBe(8192 * 2);
    } else {
      expect(data.length).toBe(8192 * 3);
    }
  });

  readable.on('readable', readableListener);
});

//<#END_FILE: test-stream-readable-infinite-read.js
