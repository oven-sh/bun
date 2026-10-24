// Flags: --expose-gc
"use strict";
// test/js/node/test/parallel/test-zlib-invalid-input-memory.js, plus a report when the stream
// survives gc(). Nothing differs from that test before gc() returns.
const common = require("../../test/common");
const { onGC } = require("../../test/common/gc");
const assert = require("assert");
const zlib = require("zlib");

let collected = false;
let retained = false;
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
      assert(err);
      setImmediate(() => {
        globalThis.gc();
        if (!collected) {
          retained = true;
          console.log("RETAINED after gc()");
          // Half of the runs: is the same call from the same frame enough the second time?
          if (process.pid % 2) {
            globalThis.gc();
            console.log("after a second gc() from the same frame: collected=" + collected);
          }
          if (!collected) require("./retention-diag").report("Inflate");
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
}
