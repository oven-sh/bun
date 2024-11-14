//#FILE: test-stream-writable-clear-buffer.js
//#SHA1: 0088292e626fb952c1777f191acee9a6d92d3f4d
//-----------------
"use strict";

const Stream = require("stream");

class StreamWritable extends Stream.Writable {
  constructor() {
    super({ objectMode: true });
  }

  // Refs: https://github.com/nodejs/node/issues/6758
  // We need a timer like on the original issue thread.
  // Otherwise the code will never reach our test case.
  _write(chunk, encoding, cb) {
    setImmediate(cb);
  }
}

test("StreamWritable bufferedRequestCount matches actual buffered request count", done => {
  const testStream = new StreamWritable();
  testStream.cork();

  const writeOperations = 5;
  let completedWrites = 0;

  for (let i = 1; i <= writeOperations; i++) {
    testStream.write(i, () => {
      expect(testStream._writableState.bufferedRequestCount).toBe(testStream._writableState.getBuffer().length);
      completedWrites++;

      if (completedWrites === writeOperations) {
        done();
      }
    });
  }

  testStream.end();
});

//<#END_FILE: test-stream-writable-clear-buffer.js
