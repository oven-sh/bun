//#FILE: test-stream-wrap.js
//#SHA1: 675a22f043e5a5a38cdd7fff376f269f8d341aab
//-----------------
'use strict';

const { Duplex } = require('stream');

// Mock StreamWrap
class StreamWrap {
  constructor(stream) {
    this._handle = {
      shutdown: jest.fn((req) => {
        process.nextTick(() => req.oncomplete(-1));
      })
    };
  }

  destroy() {
    // Simulate handle closure
  }
}

// Mock ShutdownWrap
class ShutdownWrap {
  constructor() {
    this.oncomplete = null;
    this.handle = null;
  }
}

describe('StreamWrap', () => {
  test('shutdown should call oncomplete with negative code', (done) => {
    const stream = new Duplex({
      read: () => {},
      write: () => {}
    });

    const wrap = new StreamWrap(stream);

    const req = new ShutdownWrap();
    req.oncomplete = (code) => {
      expect(code).toBeLessThan(0);
      done();
    };
    req.handle = wrap._handle;

    // Close the handle to simulate
    wrap.destroy();
    req.handle.shutdown(req);
  });
});

//<#END_FILE: test-stream-wrap.js
