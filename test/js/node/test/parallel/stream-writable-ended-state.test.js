//#FILE: test-stream-writable-ended-state.js
//#SHA1: e6a35fad059c742def91bd4cab4786faffa26f5b
//-----------------
"use strict";

const stream = require("stream");

describe("Stream Writable Ended State", () => {
  let writable;

  beforeEach(() => {
    writable = new stream.Writable();

    writable._write = (chunk, encoding, cb) => {
      expect(writable._writableState.ended).toBe(false);
      expect(writable._writableState.writable).toBeUndefined();
      expect(writable.writableEnded).toBe(false);
      cb();
    };
  });

  test("initial state", () => {
    expect(writable._writableState.ended).toBe(false);
    expect(writable._writableState.writable).toBeUndefined();
    expect(writable.writable).toBe(true);
    expect(writable.writableEnded).toBe(false);
  });

  test("ended state after end() call", done => {
    writable.end("testing ended state", () => {
      expect(writable._writableState.ended).toBe(true);
      expect(writable._writableState.writable).toBeUndefined();
      expect(writable.writable).toBe(false);
      expect(writable.writableEnded).toBe(true);
      done();
    });

    expect(writable._writableState.ended).toBe(true);
    expect(writable._writableState.writable).toBeUndefined();
    expect(writable.writable).toBe(false);
    expect(writable.writableEnded).toBe(true);
  });
});

//<#END_FILE: test-stream-writable-ended-state.js
