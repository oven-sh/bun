//#FILE: test-stream-readable-hwm-0.js
//#SHA1: 986085294672eff1ba0a13f99633edd30c3fb54a
//-----------------
"use strict";

const { Readable } = require("stream");

// This test ensures that Readable stream will call _read() for streams
// with highWaterMark === 0 upon .read(0) instead of just trying to
// emit 'readable' event.

test("Readable stream with highWaterMark 0 calls _read()", () => {
  const mockRead = jest.fn();

  const r = new Readable({
    // Must be called only once upon setting 'readable' listener
    read: mockRead,
    highWaterMark: 0,
  });

  let pushedNull = false;

  // This will trigger read(0) but must only be called after push(null)
  // because we haven't pushed any data
  r.on(
    "readable",
    jest.fn(() => {
      expect(r.read()).toBeNull();
      expect(pushedNull).toBe(true);
    }),
  );

  const endHandler = jest.fn();
  r.on("end", endHandler);

  return new Promise(resolve => {
    process.nextTick(() => {
      expect(r.read()).toBeNull();
      pushedNull = true;
      r.push(null);

      // Use setImmediate to ensure all events have been processed
      setImmediate(() => {
        expect(mockRead).toHaveBeenCalledTimes(1);
        expect(endHandler).toHaveBeenCalledTimes(1);
        resolve();
      });
    });
  });
});

//<#END_FILE: test-stream-readable-hwm-0.js
