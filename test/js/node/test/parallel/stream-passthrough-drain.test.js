//#FILE: test-stream-passthrough-drain.js
//#SHA1: c17561a8fc9a14d7abc05af3528d0ead32502a57
//-----------------
"use strict";
const { PassThrough } = require("stream");

test("PassThrough stream emits drain event when buffer is emptied", () => {
  const pt = new PassThrough({ highWaterMark: 0 });

  const drainHandler = jest.fn();
  pt.on("drain", drainHandler);

  expect(pt.write("hello1")).toBe(false);

  pt.read();
  pt.read();

  // Use process.nextTick to ensure the drain event has a chance to fire
  return new Promise(resolve => {
    process.nextTick(() => {
      expect(drainHandler).toHaveBeenCalledTimes(1);
      resolve();
    });
  });
});

//<#END_FILE: test-stream-passthrough-drain.js
