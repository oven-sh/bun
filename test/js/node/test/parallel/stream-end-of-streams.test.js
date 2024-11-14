//#FILE: test-stream-end-of-streams.js
//#SHA1: 3fa13e31cef06059026b0fcf90c151a8a975752c
//-----------------
"use strict";

const { Duplex, finished } = require("stream");

test("finished function with invalid stream", () => {
  // Passing empty object to mock invalid stream
  // should throw error
  expect(() => {
    finished({}, () => {});
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      message: expect.any(String),
    }),
  );
});

test("finished function with valid stream", () => {
  const streamObj = new Duplex();
  streamObj.end();
  // Below code should not throw any errors as the
  // streamObj is `Stream`
  expect(() => {
    finished(streamObj, () => {});
  }).not.toThrow();
});

//<#END_FILE: test-stream-end-of-streams.js
