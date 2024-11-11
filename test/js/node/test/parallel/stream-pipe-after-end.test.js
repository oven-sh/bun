//#FILE: test-stream-pipe-after-end.js
//#SHA1: 7134af5376a11c5dcdd07d230da37f1060abb468
//-----------------
'use strict';
const { Readable, Writable } = require('stream');

class TestReadable extends Readable {
  constructor(opt) {
    super(opt);
    this._ended = false;
  }

  _read() {
    if (this._ended)
      this.emit('error', new Error('_read called twice'));
    this._ended = true;
    this.push(null);
  }
}

class TestWritable extends Writable {
  constructor(opt) {
    super(opt);
    this._written = [];
  }

  _write(chunk, encoding, cb) {
    this._written.push(chunk);
    cb();
  }
}

test('read after end', (done) => {
  const ender = new TestReadable();
  
  ender.on('end', () => {
    const c = ender.read();
    expect(c).toBeNull();
    done();
  });

  // Trigger the read mechanism
  ender.read();
});

test('pipe after end', (done) => {
  const piper = new TestReadable();
  const w = new TestWritable();
  
  // End the readable stream
  piper.push(null);
  
  w.on('finish', () => {
    expect(w._written).toHaveLength(0);
    done();
  });

  piper.pipe(w);
});

//<#END_FILE: test-stream-pipe-after-end.js
