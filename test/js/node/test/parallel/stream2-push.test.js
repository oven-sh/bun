//#FILE: test-stream2-push.js
//#SHA1: 9b6aded0c40321f8d2c15dceab98b26033f23adf
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
const { Readable, Writable } = require("stream");
const EE = require("events").EventEmitter;

test("Stream2 push behavior", async () => {
  const stream = new Readable({
    highWaterMark: 16,
    encoding: "utf8",
  });

  const source = new EE();

  stream._read = function () {
    console.error("stream._read");
    readStart();
  };

  let ended = false;
  stream.on("end", function () {
    ended = true;
  });

  source.on("data", function (chunk) {
    const ret = stream.push(chunk);
    console.error("data", stream.readableLength);
    if (!ret) readStop();
  });

  source.on("end", function () {
    stream.push(null);
  });

  let reading = false;

  function readStart() {
    console.error("readStart");
    reading = true;
  }

  function readStop() {
    console.error("readStop");
    reading = false;
    process.nextTick(function () {
      const r = stream.read();
      if (r !== null) writer.write(r);
    });
  }

  const writer = new Writable({
    decodeStrings: false,
  });

  const written = [];

  const expectWritten = [
    "asdfgasdfgasdfgasdfg",
    "asdfgasdfgasdfgasdfg",
    "asdfgasdfgasdfgasdfg",
    "asdfgasdfgasdfgasdfg",
    "asdfgasdfgasdfgasdfg",
    "asdfgasdfgasdfgasdfg",
  ];

  writer._write = function (chunk, encoding, cb) {
    console.error(`WRITE ${chunk}`);
    written.push(chunk);
    process.nextTick(cb);
  };

  const finishPromise = new Promise(resolve => {
    writer.on("finish", () => {
      console.error("finish");
      expect(written).toEqual(expectWritten);
      console.log("ok");
      resolve();
    });
  });

  // Now emit some chunks.
  const chunk = "asdfg";

  let set = 0;
  readStart();

  function data() {
    expect(reading).toBe(true);
    source.emit("data", chunk);
    expect(reading).toBe(true);
    source.emit("data", chunk);
    expect(reading).toBe(true);
    source.emit("data", chunk);
    expect(reading).toBe(true);
    source.emit("data", chunk);
    expect(reading).toBe(false);
    if (set++ < 5) return new Promise(resolve => setTimeout(() => resolve(data()), 10));
    else return end();
  }

  function end() {
    source.emit("end");
    expect(reading).toBe(false);
    writer.end(stream.read());
    return new Promise(resolve =>
      setImmediate(() => {
        expect(ended).toBe(true);
        resolve();
      }),
    );
  }

  await data();
  await finishPromise;
});

//<#END_FILE: test-stream2-push.js
