//#FILE: test-stream2-pipe-error-once-listener.js
//#SHA1: a0bd981aa626f937edb6779bcf0e4dc49b82e69e
//-----------------
'use strict';

const stream = require('stream');

class Read extends stream.Readable {
  _read(size) {
    this.push('x');
    this.push(null);
  }
}

class Write extends stream.Writable {
  _write(buffer, encoding, cb) {
    this.emit('error', new Error('boom'));
    this.emit('alldone');
  }
}

test('Stream pipe error with once listener', (done) => {
  const read = new Read();
  const write = new Write();

  let errorEmitted = false;
  let alldoneEmitted = false;

  write.once('error', () => {
    errorEmitted = true;
  });

  write.once('alldone', () => {
    alldoneEmitted = true;
    expect(errorEmitted).toBe(true);
    expect(alldoneEmitted).toBe(true);
    done();
  });

  read.pipe(write);
});

//<#END_FILE: test-stream2-pipe-error-once-listener.js
