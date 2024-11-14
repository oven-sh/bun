//#FILE: test-stream-readable-aborted.js
//#SHA1: b4d59c7cd8eda084bae2d2ff603dd153aff79f98
//-----------------
"use strict";

const { Readable, Duplex } = require("stream");

test("Readable stream aborted state", () => {
  const readable = new Readable({
    read() {},
  });
  expect(readable.readableAborted).toBe(false);
  readable.destroy();
  expect(readable.readableAborted).toBe(true);
});

test("Readable stream aborted state after push(null)", () => {
  const readable = new Readable({
    read() {},
  });
  expect(readable.readableAborted).toBe(false);
  readable.push(null);
  readable.destroy();
  expect(readable.readableAborted).toBe(true);
});

test("Readable stream aborted state after push(data)", () => {
  const readable = new Readable({
    read() {},
  });
  expect(readable.readableAborted).toBe(false);
  readable.push("asd");
  readable.destroy();
  expect(readable.readableAborted).toBe(true);
});

test("Readable stream aborted state after end event", done => {
  const readable = new Readable({
    read() {},
  });
  expect(readable.readableAborted).toBe(false);
  readable.push("asd");
  readable.push(null);
  expect(readable.readableAborted).toBe(false);
  readable.on("end", () => {
    expect(readable.readableAborted).toBe(false);
    readable.destroy();
    expect(readable.readableAborted).toBe(false);
    queueMicrotask(() => {
      expect(readable.readableAborted).toBe(false);
      done();
    });
  });
  readable.resume();
});

test("Duplex stream with readable false", () => {
  const duplex = new Duplex({
    readable: false,
    write() {},
  });
  duplex.destroy();
  expect(duplex.readableAborted).toBe(false);
});

//<#END_FILE: test-stream-readable-aborted.js
