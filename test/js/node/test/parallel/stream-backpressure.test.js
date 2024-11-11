//#FILE: test-stream-backpressure.js
//#SHA1: 4ec6278015daea251bb4a9268c80a87e373d4595
//-----------------
'use strict';

const stream = require('stream');

test('Stream backpressure', (done) => {
  let pushes = 0;
  const total = 65500 + 40 * 1024;
  const readMock = jest.fn(function() {
    if (pushes++ === 10) {
      this.push(null);
      return;
    }

    const length = this._readableState.length;

    // We are at most doing two full runs of _reads
    // before stopping, because Readable is greedy
    // to keep its buffer full
    expect(length).toBeLessThanOrEqual(total);

    this.push(Buffer.alloc(65500));
    for (let i = 0; i < 40; i++) {
      this.push(Buffer.alloc(1024));
    }

    // We will be over highWaterMark at this point
    // but a new call to _read is scheduled anyway.
  });

  const rs = new stream.Readable({
    read: readMock
  });

  const writeMock = jest.fn((data, enc, cb) => {
    setImmediate(cb);
  });

  const ws = stream.Writable({
    write: writeMock
  });

  rs.pipe(ws);

  ws.on('finish', () => {
    expect(readMock).toHaveBeenCalledTimes(11);
    expect(writeMock).toHaveBeenCalledTimes(41 * 10);
    done();
  });
});

//<#END_FILE: test-stream-backpressure.js
