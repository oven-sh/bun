//#FILE: test-zlib-invalid-input-memory.js
//#SHA1: 2607db89f2850bfbe75959ca2cd56e647b9eac78
//-----------------
"use strict";
const zlib = require("zlib");
const onGC = require("../common/ongc");
const common = require("../common");

const ongc = common.mustCall();

test.todo("zlib context with error can be garbage collected", () => {
  const input = Buffer.from("foobar");
  const strm = zlib.createInflate();

  strm.end(input);

  strm.once("error", err => {
    expect(err).toBeTruthy();

    setImmediate(() => {
      global.gc();
      // Keep the event loop alive for seeing the async_hooks destroy hook we use for GC tracking...
      // TODO(addaleax): This should maybe not be necessary?
      setImmediate(() => {});
    });
  });
  onGC(strm, { ongc });
});

//<#END_FILE: test-zlib-invalid-input-memory.js
