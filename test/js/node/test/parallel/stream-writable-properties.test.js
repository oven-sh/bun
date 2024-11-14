//#FILE: test-stream-writable-properties.js
//#SHA1: 3af7ed348fc81b0a70901cb29735a8778d0a8875
//-----------------
"use strict";

const { Writable } = require("stream");

describe("Writable stream properties", () => {
  test("writableCorked property", () => {
    const w = new Writable();

    expect(w.writableCorked).toBe(0);

    w.uncork();
    expect(w.writableCorked).toBe(0);

    w.cork();
    expect(w.writableCorked).toBe(1);

    w.cork();
    expect(w.writableCorked).toBe(2);

    w.uncork();
    expect(w.writableCorked).toBe(1);

    w.uncork();
    expect(w.writableCorked).toBe(0);

    w.uncork();
    expect(w.writableCorked).toBe(0);
  });
});

//<#END_FILE: test-stream-writable-properties.js
