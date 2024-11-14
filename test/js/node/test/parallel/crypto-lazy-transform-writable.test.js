//#FILE: test-crypto-lazy-transform-writable.js
//#SHA1: 29f694c4ea89a94302b3aa84677b5e41c73077d7
//-----------------
"use strict";

const crypto = require("crypto");
const Stream = require("stream");

if (!crypto) it.skip("missing crypto", () => {});

test("crypto lazy transform writable", done => {
  const hasher1 = crypto.createHash("sha256");
  const hasher2 = crypto.createHash("sha256");

  // Calculate the expected result.
  hasher1.write(Buffer.from("hello world"));
  hasher1.end();

  const expected = hasher1.read().toString("hex");

  class OldStream extends Stream {
    constructor() {
      super();
      this.readable = true;
    }
  }

  const stream = new OldStream();

  stream.pipe(hasher2).on("finish", () => {
    const hash = hasher2.read().toString("hex");
    expect(hash).toBe(expected);
    done();
  });

  stream.emit("data", Buffer.from("hello"));
  stream.emit("data", Buffer.from(" world"));
  stream.emit("end");
});

//<#END_FILE: test-crypto-lazy-transform-writable.js
