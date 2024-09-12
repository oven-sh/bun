//#FILE: test-stream-readable-data.js
//#SHA1: c679a0f31d84cd65d9e85ab0617abfd65a053afc
//-----------------
"use strict";

const { Readable } = require("stream");

test("Readable stream emits data event after removing readable listener", done => {
  const readable = new Readable({
    read() {},
  });

  function read() {}

  readable.setEncoding("utf8");
  readable.on("readable", read);
  readable.removeListener("readable", read);

  process.nextTick(() => {
    const dataHandler = jest.fn();
    readable.on("data", dataHandler);
    readable.push("hello");

    // Use setImmediate to ensure the data event has time to be emitted
    setImmediate(() => {
      expect(dataHandler).toHaveBeenCalledTimes(1);
      done();
    });
  });
});

//<#END_FILE: test-stream-readable-data.js
