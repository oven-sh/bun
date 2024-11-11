//#FILE: test-stream2-unpipe-drain.js
//#SHA1: b04d9c383281786f45989d8d7f85f6f1a620bde2
//-----------------
'use strict';

const stream = require('stream');

class TestWriter extends stream.Writable {
  _write(buffer, encoding, callback) {
    console.log('write called');
    // Super slow write stream (callback never called)
  }
}

class TestReader extends stream.Readable {
  constructor() {
    super();
    this.reads = 0;
  }

  _read(size) {
    this.reads += 1;
    this.push(Buffer.alloc(size));
  }
}

describe('Stream2 unpipe drain', () => {
  let dest, src1, src2;

  beforeEach(() => {
    dest = new TestWriter();
    src1 = new TestReader();
    src2 = new TestReader();
  });

  test('should handle unpipe correctly', (done) => {
    src1.pipe(dest);

    src1.once('readable', () => {
      process.nextTick(() => {
        src2.pipe(dest);

        src2.once('readable', () => {
          process.nextTick(() => {
            src1.unpipe(dest);
            
            // We need to wait for the next tick to ensure all operations have completed
            process.nextTick(() => {
              expect(src1.reads).toBe(2);
              expect(src2.reads).toBe(2);
              done();
            });
          });
        });
      });
    });
  });
});

//<#END_FILE: test-stream2-unpipe-drain.js
