//#FILE: test-stream-writable-invalid-chunk.js
//#SHA1: 8febb7872aa1c8bfb7ebcb33db7a5fcd2903b2bd
//-----------------
"use strict";

const stream = require("stream");

function testWriteType(val, objectMode, code) {
  const writable = new stream.Writable({
    objectMode,
    write: () => {},
  });

  const writeOperation = () => writable.write(val);

  if (code) {
    expect(writeOperation).toThrow(
      expect.objectContaining({
        code,
        message: expect.any(String),
      }),
    );
  } else {
    expect(writeOperation).not.toThrow();
  }
}

describe("Writable stream invalid chunk tests", () => {
  test("non-object mode invalid types", () => {
    testWriteType([], false, "ERR_INVALID_ARG_TYPE");
    testWriteType({}, false, "ERR_INVALID_ARG_TYPE");
    testWriteType(0, false, "ERR_INVALID_ARG_TYPE");
    testWriteType(true, false, "ERR_INVALID_ARG_TYPE");
    testWriteType(0.0, false, "ERR_INVALID_ARG_TYPE");
    testWriteType(undefined, false, "ERR_INVALID_ARG_TYPE");
    testWriteType(null, false, "ERR_STREAM_NULL_VALUES");
  });

  test("object mode valid types", () => {
    testWriteType([], true);
    testWriteType({}, true);
    testWriteType(0, true);
    testWriteType(true, true);
    testWriteType(0.0, true);
    testWriteType(undefined, true);
  });

  test("object mode null value", () => {
    testWriteType(null, true, "ERR_STREAM_NULL_VALUES");
  });
});

//<#END_FILE: test-stream-writable-invalid-chunk.js
