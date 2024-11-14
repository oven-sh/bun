//#FILE: test-stream-writableState-uncorked-bufferedRequestCount.js
//#SHA1: 39a95157551d47517d4c7aa46d1806b5dbccebcf
//-----------------
"use strict";

const stream = require("stream");

describe("Writable stream corking and uncorking", () => {
  let writable;

  beforeEach(() => {
    writable = new stream.Writable();

    writable._writev = jest.fn((chunks, cb) => {
      expect(chunks.length).toBe(2);
      cb();
    });

    writable._write = jest.fn((chunk, encoding, cb) => {
      cb();
    });
  });

  test("corking and uncorking behavior", done => {
    // first cork
    writable.cork();
    expect(writable._writableState.corked).toBe(1);
    expect(writable._writableState.bufferedRequestCount).toBe(0);

    // cork again
    writable.cork();
    expect(writable._writableState.corked).toBe(2);

    // The first chunk is buffered
    writable.write("first chunk");
    expect(writable._writableState.bufferedRequestCount).toBe(1);

    // First uncork does nothing
    writable.uncork();
    expect(writable._writableState.corked).toBe(1);
    expect(writable._writableState.bufferedRequestCount).toBe(1);

    process.nextTick(() => {
      // The second chunk is buffered, because we uncork at the end of tick
      writable.write("second chunk");
      expect(writable._writableState.corked).toBe(1);
      expect(writable._writableState.bufferedRequestCount).toBe(2);

      // Second uncork flushes the buffer
      writable.uncork();
      expect(writable._writableState.corked).toBe(0);
      expect(writable._writableState.bufferedRequestCount).toBe(0);

      // Verify that end() uncorks correctly
      writable.cork();
      writable.write("third chunk");
      writable.end();

      // End causes an uncork() as well
      expect(writable._writableState.corked).toBe(0);
      expect(writable._writableState.bufferedRequestCount).toBe(0);

      expect(writable._writev).toHaveBeenCalledTimes(1);
      expect(writable._write).toHaveBeenCalledTimes(1);

      done();
    });
  });
});

//<#END_FILE: test-stream-writableState-uncorked-bufferedRequestCount.js
