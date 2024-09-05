//#FILE: test-stream-readable-resumeScheduled.js
//#SHA1: 3327b31acfd00e4df0bac4e89d7a764c4de6cb4b
//-----------------
"use strict";

const { Readable, Writable } = require("stream");

// Testing Readable Stream resumeScheduled state

describe("Readable Stream resumeScheduled state", () => {
  test("pipe() test case", done => {
    const r = new Readable({ read() {} });
    const w = new Writable();

    // resumeScheduled should start = `false`.
    expect(r._readableState.resumeScheduled).toBe(false);

    // Calling pipe() should change the state value = true.
    r.pipe(w);
    expect(r._readableState.resumeScheduled).toBe(true);

    process.nextTick(() => {
      expect(r._readableState.resumeScheduled).toBe(false);
      done();
    });
  });

  test("data listener test case", done => {
    const r = new Readable({ read() {} });

    // resumeScheduled should start = `false`.
    expect(r._readableState.resumeScheduled).toBe(false);

    r.push(Buffer.from([1, 2, 3]));

    // Adding 'data' listener should change the state value
    r.on(
      "data",
      jest.fn(() => {
        expect(r._readableState.resumeScheduled).toBe(false);
      }),
    );
    expect(r._readableState.resumeScheduled).toBe(true);

    process.nextTick(() => {
      expect(r._readableState.resumeScheduled).toBe(false);
      done();
    });
  });

  test("resume() test case", done => {
    const r = new Readable({ read() {} });

    // resumeScheduled should start = `false`.
    expect(r._readableState.resumeScheduled).toBe(false);

    // Calling resume() should change the state value.
    r.resume();
    expect(r._readableState.resumeScheduled).toBe(true);

    const resumeHandler = jest.fn(() => {
      // The state value should be `false` again
      expect(r._readableState.resumeScheduled).toBe(false);
    });

    r.on("resume", resumeHandler);

    process.nextTick(() => {
      expect(r._readableState.resumeScheduled).toBe(false);
      expect(resumeHandler).toHaveBeenCalledTimes(1);
      done();
    });
  });
});

//<#END_FILE: test-stream-readable-resumeScheduled.js
