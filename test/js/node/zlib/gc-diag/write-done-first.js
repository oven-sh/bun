// Flags: --expose-gc
"use strict";
// test/js/node/test/parallel/test-zlib-invalid-input-memory.js, except that the main script stays
// busy until the thread pool has finished the write. The 'error' event then comes in the first
// turn of the event loop, before the collection that follows the entry point.
const common = require("../../test/common");
const { onGC } = require("../../test/common/gc");
const assert = require("assert");
const zlib = require("zlib");

const ongc = common.mustCall();

{
  const input = Buffer.from("foobar");
  const strm = zlib.createInflate();
  strm.end(input);
  strm.once(
    "error",
    common.mustCall(err => {
      assert(err);
      setImmediate(() => {
        globalThis.gc();
        setImmediate(() => {});
      });
    }),
  );
  onGC(strm, { ongc });
}

for (const end = performance.now() + 25; performance.now() < end;);
