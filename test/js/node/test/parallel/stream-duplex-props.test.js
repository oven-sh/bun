//#FILE: test-stream-duplex-props.js
//#SHA1: ae1e09a8b6631f457ad8587544a2a245f3c2ef04
//-----------------
"use strict";

const { Duplex } = require("stream");

test("Duplex stream with same object mode and high water mark for readable and writable", () => {
  const d = new Duplex({
    objectMode: true,
    highWaterMark: 100,
  });

  expect(d.writableObjectMode).toBe(true);
  expect(d.writableHighWaterMark).toBe(100);
  expect(d.readableObjectMode).toBe(true);
  expect(d.readableHighWaterMark).toBe(100);
});

test("Duplex stream with different object mode and high water mark for readable and writable", () => {
  const d = new Duplex({
    readableObjectMode: false,
    readableHighWaterMark: 10,
    writableObjectMode: true,
    writableHighWaterMark: 100,
  });

  expect(d.writableObjectMode).toBe(true);
  expect(d.writableHighWaterMark).toBe(100);
  expect(d.readableObjectMode).toBe(false);
  expect(d.readableHighWaterMark).toBe(10);
});

//<#END_FILE: test-stream-duplex-props.js
