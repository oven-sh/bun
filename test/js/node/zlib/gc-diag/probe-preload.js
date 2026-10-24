"use strict";
// Preload for the unmodified test-zlib-invalid-input-memory.js: reports when the stream survives
// gc(). It learns that from the test's own calls: onGC() tells when the listener fires, and the
// test's second setImmediate() call comes right after gc() returns, from the same frame.
const path = require("path");
const gc = require(path.join(__dirname, "..", "..", "test", "common", "gc.js"));

let armed = false;
let collected = false;
let calls = 0;
const onGC = gc.onGC;
gc.onGC = function (value, holder) {
  const ongc = holder.ongc;
  holder.ongc = () => {
    collected = true;
    ongc();
  };
  armed = true;
  return onGC(value, holder);
};

const setImmediate = globalThis.setImmediate;
globalThis.setImmediate = function (...args) {
  if (armed && ++calls === 2 && !collected) {
    console.log("RETAINED after gc()");
    require("./retention-diag").report("Inflate");
    process.on("exit", () => {
      console.log("EXIT before another gc() collected=" + collected);
      if (!collected) globalThis.gc();
      console.log("EXIT collected=" + collected);
    });
  }
  return setImmediate(...args);
};
