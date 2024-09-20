//#FILE: test-stream-readable-setEncoding-existing-buffers.js
//#SHA1: 1b54f93d0be77b949ce81135243cc9ab3318db5b
//-----------------
"use strict";

const { Readable } = require("stream");

test("Call .setEncoding() while there are bytes already in the buffer", done => {
  const r = new Readable({ read() {} });

  r.push(Buffer.from("a"));
  r.push(Buffer.from("b"));

  r.setEncoding("utf8");
  const chunks = [];
  r.on("data", chunk => chunks.push(chunk));

  process.nextTick(() => {
    expect(chunks).toEqual(["ab"]);
    done();
  });
});

test("Call .setEncoding() while the buffer contains a complete, but chunked character", done => {
  const r = new Readable({ read() {} });

  r.push(Buffer.from([0xf0]));
  r.push(Buffer.from([0x9f]));
  r.push(Buffer.from([0x8e]));
  r.push(Buffer.from([0x89]));

  r.setEncoding("utf8");
  const chunks = [];
  r.on("data", chunk => chunks.push(chunk));

  process.nextTick(() => {
    expect(chunks).toEqual(["🎉"]);
    done();
  });
});

test("Call .setEncoding() while the buffer contains an incomplete character, and finish the character later", done => {
  const r = new Readable({ read() {} });

  r.push(Buffer.from([0xf0]));
  r.push(Buffer.from([0x9f]));

  r.setEncoding("utf8");

  r.push(Buffer.from([0x8e]));
  r.push(Buffer.from([0x89]));

  const chunks = [];
  r.on("data", chunk => chunks.push(chunk));

  process.nextTick(() => {
    expect(chunks).toEqual(["🎉"]);
    done();
  });
});

//<#END_FILE: test-stream-readable-setEncoding-existing-buffers.js
