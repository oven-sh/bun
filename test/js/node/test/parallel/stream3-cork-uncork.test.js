//#FILE: test-stream3-cork-uncork.js
//#SHA1: d1cc0d9e9be4ae657ab2db8e02589ac485268c63
//-----------------
'use strict';
const stream = require('stream');
const Writable = stream.Writable;

describe('Writable stream cork and uncork', () => {
  const expectedChunks = ['please', 'buffer', 'me', 'kindly'];
  let inputChunks;
  let seenChunks;
  let seenEnd;
  let w;

  beforeEach(() => {
    inputChunks = expectedChunks.slice(0);
    seenChunks = [];
    seenEnd = false;

    w = new Writable();
    w._write = function(chunk, encoding, cb) {
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
    seenChunks = [];
  });

  test('cork and uncork behavior', async () => {
    w.cork();

    await writeChunks(inputChunks);

    expect(seenChunks.length).toBe(0);

    w.uncork();

    expect(seenChunks.length).toBe(4);

    for (let i = 0; i < expectedChunks.length; i++) {
      const seen = seenChunks[i];
      expect(seen).toBeTruthy();

      const expected = Buffer.from(expectedChunks[i]);
      expect(seen.equals(expected)).toBe(true);
    }

    await new Promise((resolve) => setImmediate(resolve));
    expect(seenEnd).toBe(false);
  });
});

//<#END_FILE: test-stream3-cork-uncork.js
