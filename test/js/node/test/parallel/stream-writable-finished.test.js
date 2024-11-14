//#FILE: test-stream-writable-finished.js
//#SHA1: 20d27885cc10a6787d3e6c6fb877c0aba2310f93
//-----------------
"use strict";

const { Writable } = require("stream");

// basic
test("Writable.prototype has writableFinished", () => {
  expect(Object.hasOwn(Writable.prototype, "writableFinished")).toBe(true);
});

// event
test("writableFinished state changes correctly", done => {
  const writable = new Writable();

  writable._write = (chunk, encoding, cb) => {
    // The state finished should start in false.
    expect(writable.writableFinished).toBe(false);
    cb();
  };

  writable.on("finish", () => {
    expect(writable.writableFinished).toBe(true);
    done();
  });

  writable.end("testing finished state", () => {
    expect(writable.writableFinished).toBe(true);
  });
});

test("Emit finish asynchronously", done => {
  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    },
  });

  w.end();
  w.on("finish", done);
});

test("Emit prefinish synchronously", () => {
  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    },
  });

  let sync = true;
  w.on("prefinish", () => {
    expect(sync).toBe(true);
  });
  w.end();
  sync = false;
});

test("Emit prefinish synchronously w/ final", () => {
  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    },
    final(cb) {
      cb();
    },
  });

  let sync = true;
  w.on("prefinish", () => {
    expect(sync).toBe(true);
  });
  w.end();
  sync = false;
});

test("Call _final synchronously", () => {
  let sync = true;
  const finalMock = jest.fn(cb => {
    expect(sync).toBe(true);
    cb();
  });

  const w = new Writable({
    write(chunk, encoding, cb) {
      cb();
    },
    final: finalMock,
  });

  w.end();
  sync = false;

  expect(finalMock).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-stream-writable-finished.js
