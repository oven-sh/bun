//#FILE: test-stream3-pipeline-async-iterator.js
//#SHA1: db2d5b4cb6c502fdccdfa1ed9384d6baa70b1e0b
//-----------------
/* eslint-disable node-core/require-common-first, require-yield */
"use strict";
const { pipeline } = require("node:stream/promises");

test("async iterators can act as readable and writable streams", async () => {
  // Ensure that async iterators can act as readable and writable streams
  async function* myCustomReadable() {
    yield "Hello";
    yield "World";
  }

  const messages = [];
  async function* myCustomWritable(stream) {
    for await (const chunk of stream) {
      messages.push(chunk);
    }
  }

  await pipeline(myCustomReadable, myCustomWritable);

  expect(messages).toEqual(["Hello", "World"]);
});

//<#END_FILE: test-stream3-pipeline-async-iterator.js
