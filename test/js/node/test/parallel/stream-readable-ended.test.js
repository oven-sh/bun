//#FILE: test-stream-readable-ended.js
//#SHA1: 93aa267630bb32f94783c5bbdeb8e345c0acd94a
//-----------------
"use strict";

const { Readable } = require("stream");

// basic
test("Readable.prototype has readableEnded property", () => {
  expect(Object.hasOwn(Readable.prototype, "readableEnded")).toBe(true);
});

// event
test("readableEnded state changes correctly", done => {
  const readable = new Readable();

  readable._read = () => {
    // The state ended should start in false.
    expect(readable.readableEnded).toBe(false);
    readable.push("asd");
    expect(readable.readableEnded).toBe(false);
    readable.push(null);
    expect(readable.readableEnded).toBe(false);
  };

  readable.on("end", () => {
    expect(readable.readableEnded).toBe(true);
    done();
  });

  readable.on("data", () => {
    expect(readable.readableEnded).toBe(false);
  });
});

// Verifies no `error` triggered on multiple .push(null) invocations
test("No error triggered on multiple .push(null) invocations", done => {
  const readable = new Readable();

  readable.on("readable", () => {
    readable.read();
  });

  const errorHandler = jest.fn();
  readable.on("error", errorHandler);

  readable.on("end", () => {
    expect(errorHandler).not.toHaveBeenCalled();
    done();
  });

  readable.push("a");
  readable.push(null);
  readable.push(null);
});

//<#END_FILE: test-stream-readable-ended.js
