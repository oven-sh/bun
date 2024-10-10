//#FILE: test-stream-writable-finished-state.js
//#SHA1: e9ea6f7cc3e0262bf187b9cf08e9a054c93d7b5f
//-----------------
"use strict";

const stream = require("stream");

test("Writable stream finished state", done => {
  const writable = new stream.Writable();

  writable._write = (chunk, encoding, cb) => {
    // The state finished should start in false.
    expect(writable._writableState.finished).toBe(false);
    cb();
  };

  writable.on("finish", () => {
    expect(writable._writableState.finished).toBe(true);
  });

  writable.end("testing finished state", () => {
    expect(writable._writableState.finished).toBe(true);
    done();
  });
});

//<#END_FILE: test-stream-writable-finished-state.js
