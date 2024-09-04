//#FILE: test-stream-decoder-objectmode.js
//#SHA1: 373c0c494e625b8264fae296b46f16a5cd5a9ef8
//-----------------
"use strict";

const stream = require("stream");

test("stream.Readable with objectMode and utf16le encoding", () => {
  const readable = new stream.Readable({
    read: () => {},
    encoding: "utf16le",
    objectMode: true,
  });

  readable.push(Buffer.from("abc", "utf16le"));
  readable.push(Buffer.from("def", "utf16le"));
  readable.push(null);

  // Without object mode, these would be concatenated into a single chunk.
  expect(readable.read()).toBe("abc");
  expect(readable.read()).toBe("def");
  expect(readable.read()).toBeNull();
});

//<#END_FILE: test-stream-decoder-objectmode.js
