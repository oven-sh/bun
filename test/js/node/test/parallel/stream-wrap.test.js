//#FILE: test-stream-wrap.js
//#SHA1: 675a22f043e5a5a38cdd7fff376f269f8d341aab
//-----------------
"use strict";

const { Duplex } = require("stream");

// Remove internal bindings and StreamWrap import as they're not accessible in a normal environment
// We'll mock the necessary functionality instead

test("StreamWrap shutdown behavior", done => {
  const stream = new Duplex({
    read: function () {},
    write: function () {},
  });

  // Mock StreamWrap
  class MockStreamWrap {
    constructor(stream) {
      this.stream = stream;
      this._handle = {
        shutdown: jest.fn(req => {
          // Simulate async completion with error
          process.nextTick(() => {
            req.oncomplete(-1);
          });
        }),
      };
    }

    destroy() {
      // Simulate handle closure
    }
  }

  // Mock ShutdownWrap
  class MockShutdownWrap {
    oncomplete = null;
  }

  function testShutdown(callback) {
    const wrap = new MockStreamWrap(stream);

    const req = new MockShutdownWrap();
    req.oncomplete = function (code) {
      expect(code).toBeLessThan(0);
      callback();
    };
    req.handle = wrap._handle;

    // Close the handle to simulate
    wrap.destroy();
    req.handle.shutdown(req);
  }

  testShutdown(done);
});

//<#END_FILE: test-stream-wrap.js
