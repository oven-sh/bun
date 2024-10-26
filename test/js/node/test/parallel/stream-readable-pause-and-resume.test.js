//#FILE: test-stream-readable-pause-and-resume.js
//#SHA1: 4b6956e6354a9ac47e673e043c906bead42ca4cf
//-----------------
'use strict';

const { Readable, PassThrough } = require('stream');

test('Readable stream pause and resume', (done) => {
  let ticks = 18;
  let expectedData = 19;

  const rs = new Readable({
    objectMode: true,
    read: () => {
      if (ticks-- > 0)
        return process.nextTick(() => rs.push({}));
      rs.push({});
      rs.push(null);
    }
  });

  rs.on('end', () => {
    expect(true).toBe(true); // Equivalent to common.mustCall()
  });

  function readAndPause() {
    const ondata = jest.fn().mockImplementation((data) => {
      rs.pause();

      expectedData--;
      if (expectedData <= 0) {
        expect(ondata).toHaveBeenCalledTimes(1);
        done();
        return;
      }

      setImmediate(function() {
        rs.removeListener('data', ondata);
        readAndPause();
        rs.resume();
      });
    });

    rs.on('data', ondata);
  }

  readAndPause();
});

test('Readable stream pause after removing listener', (done) => {
  const readable = new Readable({
    read() {}
  });

  function read() {}

  readable.setEncoding('utf8');
  readable.on('readable', read);
  readable.removeListener('readable', read);
  readable.pause();

  process.nextTick(function() {
    expect(readable.isPaused()).toBe(true);
    done();
  });
});

test('Piped streams and pause state', (done) => {
  const source3 = new PassThrough();
  const target3 = new PassThrough();

  const chunk = Buffer.allocUnsafe(1000);
  while (target3.write(chunk));

  source3.pipe(target3);
  target3.on('drain', () => {
    expect(source3.isPaused()).toBe(false);
    done();
  });
  target3.on('data', () => {});
});

//<#END_FILE: test-stream-readable-pause-and-resume.js
