//#FILE: test-stream-readable-readable.js
//#SHA1: f2d897473803968b7ee8efb20a8f1f374987980b
//-----------------
"use strict";

const { Readable } = require("stream");

describe("Readable.readable", () => {
  test("readable property is set correctly", () => {
    const r = new Readable({
      read() {},
    });
    expect(r.readable).toBe(true);
    r.destroy();
    expect(r.readable).toBe(false);
  });

  test("readable property remains true until end event", () => {
    const r = new Readable({
      read() {},
    });
    expect(r.readable).toBe(true);

    const endHandler = jest.fn();
    r.on("end", endHandler);
    r.resume();
    r.push(null);
    expect(r.readable).toBe(true);
    r.off("end", endHandler);

    return new Promise(resolve => {
      r.on("end", () => {
        expect(r.readable).toBe(false);
        resolve();
      });
    });
  });

  test("readable property becomes false on error", () => {
    const r = new Readable({
      read: jest.fn(() => {
        process.nextTick(() => {
          r.destroy(new Error());
          expect(r.readable).toBe(false);
        });
      }),
    });
    r.resume();

    return new Promise(resolve => {
      r.on("error", () => {
        expect(r.readable).toBe(false);
        resolve();
      });
    });
  });
});

//<#END_FILE: test-stream-readable-readable.js
