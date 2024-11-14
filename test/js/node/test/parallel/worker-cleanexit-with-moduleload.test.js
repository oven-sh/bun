//#FILE: test-worker-cleanexit-with-moduleload.js
//#SHA1: cdaed88b3a0ebbc07619e10f35ea0c62e5134b63
//-----------------
"use strict";

const { Worker } = require("worker_threads");

// Harden the thread interactions on the exit path.
// Ensure workers are able to bail out safe at
// arbitrary execution points. By using a number of
// internal modules as load candidates, the expectation
// is that those will be at various control flow points
// preferably in the C++ land.

const modules = ["fs", "assert", "async_hooks", "buffer", "child_process", "net", "http", "os", "path", "v8", "vm"];

if (process.versions.openssl) {
  modules.push("https");
}

test("Workers can exit cleanly while loading modules", done => {
  for (let i = 0; i < 10; i++) {
    new Worker(
      `const modules = [${modules.map(m => `'${m}'`)}];` +
        "modules.forEach((module) => {" +
        "const m = require(module);" +
        "});",
      { eval: true },
    );
  }

  // Allow workers to go live.
  setTimeout(() => {
    done();
  }, 200);
}, 300); // Set timeout to 300ms to allow for the 200ms delay

//<#END_FILE: test-worker-cleanexit-with-moduleload.js
