//#FILE: test-stream-set-default-hwm.js
//#SHA1: bc1189f9270a4b5463d8421ef234fc7baaad667f
//-----------------
"use strict";

const { setDefaultHighWaterMark, getDefaultHighWaterMark, Writable, Readable, Transform } = require("stream");

test("setDefaultHighWaterMark and getDefaultHighWaterMark for object mode", () => {
  expect(getDefaultHighWaterMark(false)).not.toBe(32 * 1000);
  setDefaultHighWaterMark(false, 32 * 1000);
  expect(getDefaultHighWaterMark(false)).toBe(32 * 1000);
});

test("setDefaultHighWaterMark and getDefaultHighWaterMark for non-object mode", () => {
  expect(getDefaultHighWaterMark(true)).not.toBe(32);
  setDefaultHighWaterMark(true, 32);
  expect(getDefaultHighWaterMark(true)).toBe(32);
});

test("Writable stream uses new default high water mark", () => {
  const w = new Writable({
    write() {},
  });
  expect(w.writableHighWaterMark).toBe(32 * 1000);
});

test("Readable stream uses new default high water mark", () => {
  const r = new Readable({
    read() {},
  });
  expect(r.readableHighWaterMark).toBe(32 * 1000);
});

test("Transform stream uses new default high water mark for both readable and writable", () => {
  const t = new Transform({
    transform() {},
  });
  expect(t.writableHighWaterMark).toBe(32 * 1000);
  expect(t.readableHighWaterMark).toBe(32 * 1000);
});

//<#END_FILE: test-stream-set-default-hwm.js
