//#FILE: test-zlib-deflate-raw-inherits.js
//#SHA1: 9e1873864f4af27abf3a8a36a87edd2d036805d8
//-----------------
"use strict";

const { DeflateRaw } = require("zlib");
const { Readable } = require("stream");

// Validates that zlib.DeflateRaw can be inherited
// with Object.setPrototypeOf

test("DeflateRaw can be inherited with Object.setPrototypeOf", done => {
  function NotInitialized(options) {
    DeflateRaw.call(this, options);
    this.prop = true;
  }
  Object.setPrototypeOf(NotInitialized.prototype, DeflateRaw.prototype);
  Object.setPrototypeOf(NotInitialized, DeflateRaw);

  const dest = new NotInitialized();

  const read = new Readable({
    read() {
      this.push(Buffer.from("a test string"));
      this.push(null);
    },
  });

  read.pipe(dest);
  dest.resume();

  // We need to add an event listener to ensure the test completes
  dest.on("finish", () => {
    expect(dest.prop).toBe(true);
    expect(dest instanceof DeflateRaw).toBe(true);
    done();
  });
});

//<#END_FILE: test-zlib-deflate-raw-inherits.js
