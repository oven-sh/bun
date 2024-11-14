//#FILE: test-stream-writable-aborted.js
//#SHA1: be315bbc27ad16f13bb6b3022e864c8902265391
//-----------------
"use strict";

const { Writable } = require("stream");

describe("Writable stream aborted property", () => {
  test("writableAborted is false initially and true after destroy", () => {
    const writable = new Writable({
      write() {},
    });
    expect(writable.writableAborted).toBe(false);
    writable.destroy();
    expect(writable.writableAborted).toBe(true);
  });

  test("writableAborted is false initially and true after end and destroy", () => {
    const writable = new Writable({
      write() {},
    });
    expect(writable.writableAborted).toBe(false);
    writable.end();
    writable.destroy();
    expect(writable.writableAborted).toBe(true);
  });
});

//<#END_FILE: test-stream-writable-aborted.js
