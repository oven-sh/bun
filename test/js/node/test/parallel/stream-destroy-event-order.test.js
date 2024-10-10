//#FILE: test-stream-destroy-event-order.js
//#SHA1: 0d5e12d85e093a1d7c118a2e15cf0c38c1ab96f6
//-----------------
"use strict";

const { Readable } = require("stream");

test("Readable stream destroy event order", () => {
  const rs = new Readable({
    read() {},
  });

  let closed = false;
  let errored = false;

  rs.on("close", () => {
    closed = true;
    expect(errored).toBe(true);
  });

  rs.on("error", () => {
    errored = true;
    expect(closed).toBe(false);
  });

  rs.destroy(new Error("kaboom"));

  return new Promise(resolve => {
    rs.on("close", () => {
      expect(closed).toBe(true);
      expect(errored).toBe(true);
      resolve();
    });
  });
});

//<#END_FILE: test-stream-destroy-event-order.js
