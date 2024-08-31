//#FILE: test-stream-writable-null.js
//#SHA1: 5a080b117b05a98d0b7bf6895b554892c2690ed8
//-----------------
"use strict";

const stream = require("stream");

class MyWritable extends stream.Writable {
  constructor(options) {
    super({ autoDestroy: false, ...options });
  }
  _write(chunk, encoding, callback) {
    expect(chunk).not.toBe(null);
    callback();
  }
}

test("MyWritable throws on null in object mode", () => {
  const m = new MyWritable({ objectMode: true });
  expect(() => {
    m.write(null);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_STREAM_NULL_VALUES",
    }),
  );
});

test("MyWritable throws on false in non-object mode", () => {
  const m = new MyWritable();
  expect(() => {
    m.write(false);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
    }),
  );
});

test("MyWritable should not throw on false in object mode", done => {
  const m = new MyWritable({ objectMode: true });
  m.write(false, err => {
    expect(err).toBeFalsy();
    done();
  });
});

test("MyWritable should not throw or emit error on false in object mode", done => {
  const m = new MyWritable({ objectMode: true }).on("error", e => {
    done(e || new Error("should not get here"));
  });
  m.write(false, err => {
    expect(err).toBeFalsy();
    done();
  });
});

//<#END_FILE: test-stream-writable-null.js
