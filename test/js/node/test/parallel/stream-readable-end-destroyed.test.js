//#FILE: test-stream-readable-end-destroyed.js
//#SHA1: 20c8bb870db11018d2eaa1c9e4dece071917d03d
//-----------------
'use strict';

const { Readable } = require('stream');

test("Don't emit 'end' after 'close'", (done) => {
  const r = new Readable();

  const endListener = jest.fn();
  const closeListener = jest.fn(() => {
    r.push(null);
    
    // Use setImmediate to ensure all microtasks have been processed
    setImmediate(() => {
      expect(endListener).not.toHaveBeenCalled();
      expect(closeListener).toHaveBeenCalled();
      done();
    });
  });

  r.on('end', endListener);
  r.resume();
  r.destroy();
  r.on('close', closeListener);
});

//<#END_FILE: test-stream-readable-end-destroyed.js
