//#FILE: test-stream3-cork-end.js
//#SHA1: 1ac6a2589bee41bc1e9e08ef308bcae3cd999106
//-----------------
'use strict';
const stream = require('stream');
const Writable = stream.Writable;

describe('Writable stream buffering behavior', () => {
  let w;
  let seenChunks;
  let seenEnd;
  const expectedChunks = ['please', 'buffer', 'me', 'kindly'];
  const inputChunks = expectedChunks.slice(0);

  beforeEach(() => {
    seenChunks = [];
    seenEnd = false;

    w = new Writable();
    w._write = function(chunk, encoding, cb) {
      expect(seenEnd).toBe(false);
      expect(encoding).toBe('buffer');
      seenChunks.push(chunk);
      cb();
    };
    w.on('finish', () => {
      seenEnd = true;
    });
  });

  function writeChunks(remainingChunks) {
    return new Promise((resolve) => {
      function write() {
        const writeChunk = remainingChunks.shift();
        if (writeChunk) {
          setImmediate(() => {
            const writeState = w.write(writeChunk);
            expect(writeState).toBe(true);
            write();
          });
        } else {
          resolve();
        }
      }
      write();
    });
  }

  test('initial write is immediate', () => {
    w.write('stuff');
    expect(seenChunks.length).toBe(1);
  });

  test('cork() triggers buffering', (done) => {
    w.cork();

    writeChunks(inputChunks).then(() => {
      expect(seenChunks.length).toBe(0);

      w.end();

      expect(seenEnd).toBe(false);
      expect(seenChunks.length).toBe(4);

      for (let i = 0; i < expectedChunks.length; i++) {
        const seen = seenChunks[i];
        expect(seen).toBeTruthy();
        const expected = Buffer.from(expectedChunks[i]);
        expect(seen.equals(expected)).toBe(true);
      }

      setImmediate(() => {
        expect(seenEnd).toBe(true);
        done();
      });
    });
  });
});

//<#END_FILE: test-stream3-cork-end.js
