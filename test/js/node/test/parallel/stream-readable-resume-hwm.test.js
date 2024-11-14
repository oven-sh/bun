//#FILE: test-stream-readable-resume-hwm.js
//#SHA1: 8149b27327258da89c087856f54e7e7584ddf1e5
//-----------------
"use strict";
const { Readable } = require("stream");

// readable.resume() should not lead to a ._read() call being scheduled
// when we exceed the high water mark already.

test("readable.resume() should not call _read() when exceeding highWaterMark", () => {
  const mockRead = jest.fn();
  const readable = new Readable({
    read: mockRead,
    highWaterMark: 100,
  });

  // Fill up the internal buffer so that we definitely exceed the HWM:
  for (let i = 0; i < 10; i++) readable.push("a".repeat(200));

  // Call resume, and pause after one chunk.
  // The .pause() is just so that we don't empty the buffer fully, which would
  // be a valid reason to call ._read().
  readable.resume();

  return new Promise(resolve => {
    readable.once("data", () => {
      readable.pause();
      expect(mockRead).not.toHaveBeenCalled();
      resolve();
    });
  });
});

//<#END_FILE: test-stream-readable-resume-hwm.js
