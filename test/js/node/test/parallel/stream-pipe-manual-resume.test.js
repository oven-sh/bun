//#FILE: test-stream-pipe-manual-resume.js
//#SHA1: ba3009a6de3e4901a273f70833e9dfb5529217ed
//-----------------
'use strict';
const stream = require('stream');

function createTest(throwCodeInbetween) {
  return new Promise((resolve) => {
    const n = 1000;
    let counter = n;
    let readCount = 0;
    let writeCount = 0;

    const rs = stream.Readable({
      objectMode: true,
      read: () => {
        readCount++;
        if (--counter >= 0)
          rs.push({ counter });
        else
          rs.push(null);
      }
    });

    const ws = stream.Writable({
      objectMode: true,
      write: (data, enc, cb) => {
        writeCount++;
        setImmediate(cb);
      }
    });

    ws.on('finish', () => {
      expect(readCount).toBeGreaterThanOrEqual(n);
      expect(writeCount).toBe(n);
      resolve();
    });

    setImmediate(() => throwCodeInbetween(rs, ws));

    rs.pipe(ws);
  });
}

test('pipe does not stall if .read() is called unexpectedly', async () => {
  await createTest((rs) => rs.read());
});

test('pipe does not stall if .resume() is called unexpectedly', async () => {
  await createTest((rs) => rs.resume());
});

test('pipe does not stall with no interference', async () => {
  await createTest(() => 0);
});

//<#END_FILE: test-stream-pipe-manual-resume.js
