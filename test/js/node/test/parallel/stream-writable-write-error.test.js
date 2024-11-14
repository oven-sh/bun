//#FILE: test-stream-writable-write-error.js
//#SHA1: 16053b21f2a6c80ae69ae55424550e7213f1f868
//-----------------
"use strict";

const { Writable } = require("stream");

function expectError(w, args, code, sync) {
  if (sync) {
    if (code) {
      expect(() => w.write(...args)).toThrow(
        expect.objectContaining({
          code,
          message: expect.any(String),
        }),
      );
    } else {
      w.write(...args);
    }
  } else {
    let errorCalled = false;
    let ticked = false;
    w.write(...args, err => {
      expect(ticked).toBe(true);
      expect(errorCalled).toBe(false);
      expect(err.code).toBe(code);
    });
    ticked = true;
    w.on("error", err => {
      errorCalled = true;
      expect(err.code).toBe(code);
    });
  }
}

function runTest(autoDestroy) {
  test("write after end", () => {
    const w = new Writable({
      autoDestroy,
      write() {},
    });
    w.end();
    expectError(w, ["asd"], "ERR_STREAM_WRITE_AFTER_END");
  });

  test("write after destroy", () => {
    const w = new Writable({
      autoDestroy,
      write() {},
    });
    w.destroy();
  });

  test("write null values", () => {
    const w = new Writable({
      autoDestroy,
      write() {},
    });
    expectError(w, [null], "ERR_STREAM_NULL_VALUES", true);
  });

  test("write invalid arg type", () => {
    const w = new Writable({
      autoDestroy,
      write() {},
    });
    expectError(w, [{}], "ERR_INVALID_ARG_TYPE", true);
  });

  test("write with unknown encoding", () => {
    const w = new Writable({
      decodeStrings: false,
      autoDestroy,
      write() {},
    });
    expectError(w, ["asd", "noencoding"], "ERR_UNKNOWN_ENCODING", true);
  });
}

describe("Writable stream write errors (autoDestroy: false)", () => {
  runTest(false);
});

describe("Writable stream write errors (autoDestroy: true)", () => {
  runTest(true);
});

//<#END_FILE: test-stream-writable-write-error.js
