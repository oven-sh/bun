// Flags: --expose-gc
"use strict";
// v1.js, plus the time from the end of the main script to the 'error' event. That tells whether
// the write completed before or after the collection that follows the entry point.
const common = require("../../test/common");
const { onGC } = require("../../test/common/gc");
const assert = require("assert");
const zlib = require("zlib");

let collected = false;
let retained = false;
let mainEnd = 0;
let errorAt = 0;
const ongc = common.mustCall(() => {
  collected = true;
});

{
  const input = Buffer.from("foobar");
  const strm = zlib.createInflate();
  strm.end(input);
  strm.once(
    "error",
    common.mustCall(err => {
      errorAt = performance.now();
      assert(err);
      setImmediate(() => {
        globalThis.gc();
        console.log(`ORDER error-after-main-ms=${(errorAt - mainEnd).toFixed(3)} collected=${collected}`);
        if (!collected) {
          retained = true;
          console.log("RETAINED after gc()");
          require("./retention-diag").report("Inflate");
        }
        setImmediate(() => {
          if (!retained) return;
          // `false` here is the case in which the original test fails.
          console.log("NEXT-IMMEDIATE collected=" + collected);
          if (!collected) globalThis.gc();
          console.log("NEXT-IMMEDIATE after another gc() collected=" + collected);
          process.on("exit", () => {
            if (!collected) globalThis.gc();
            console.log("EXIT collected=" + collected);
          });
        });
      });
    }),
  );
  onGC(strm, { ongc });
  mainEnd = performance.now();
}
