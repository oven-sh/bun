//#FILE: test-stream-duplex-writable-finished.js
//#SHA1: ba8c61c576c3a900076baa134c8a0d6876e84db5
//-----------------
"use strict";

const { Duplex } = require("stream");

// basic
test("Duplex.prototype has writableFinished", () => {
  expect(Object.hasOwn(Duplex.prototype, "writableFinished")).toBe(true);
});

// event
test("writableFinished state changes correctly", done => {
  const duplex = new Duplex();

  duplex._write = (chunk, encoding, cb) => {
    // The state finished should start in false.
    expect(duplex.writableFinished).toBe(false);
    cb();
  };

  duplex.on("finish", () => {
    expect(duplex.writableFinished).toBe(true);
  });

  duplex.end("testing finished state", () => {
    expect(duplex.writableFinished).toBe(true);
    done();
  });
});

//<#END_FILE: test-stream-duplex-writable-finished.js
