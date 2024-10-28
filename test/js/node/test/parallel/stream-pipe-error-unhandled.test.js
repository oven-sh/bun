//#FILE: test-stream-pipe-error-unhandled.js
//#SHA1: aff5dcba0a1b31ffbfbb90ec3699530bf1b73e9b
//-----------------
'use strict';
const { Readable, Writable } = require('stream');

test('stream pipe error handling', (done) => {
  const r = new Readable({
    read() {
      this.push('asd');
    }
  });
  
  const w = new Writable({
    autoDestroy: true,
    write() {}
  });

  w.on('error', (err) => {
    expect(err).toEqual(expect.objectContaining({
      message: 'asd'
    }));
    done();
  });

  r.pipe(w);
  w.destroy(new Error('asd'));
});

//<#END_FILE: test-stream-pipe-error-unhandled.js
