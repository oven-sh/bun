//#FILE: test-stream-readable-hwm-0-async.js
//#SHA1: ddaa3718bf6d6ae9258293494ac3449800169768
//-----------------
"use strict";

const { Readable } = require("stream");

// This test ensures that Readable stream will continue to call _read
// for streams with highWaterMark === 0 once the stream returns data
// by calling push() asynchronously.

test("Readable stream with highWaterMark 0 and async push", async () => {
  let count = 5;
  const readMock = jest.fn(() => {
    process.nextTick(() => {
      if (count--) {
        r.push("a");
      } else {
        r.push(null);
      }
    });
  });

  const r = new Readable({
    read: readMock,
    highWaterMark: 0,
  });

  const dataHandler = jest.fn();
  const endHandler = jest.fn();

  r.on("data", dataHandler);
  r.on("end", endHandler);

  // Consume the stream
  for await (const chunk of r) {
    // This loop will iterate 5 times
  }

  // Called 6 times: First 5 return data, last one signals end of stream.
  expect(readMock).toHaveBeenCalledTimes(6);
  expect(dataHandler).toHaveBeenCalledTimes(5);
  expect(endHandler).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-stream-readable-hwm-0-async.js
