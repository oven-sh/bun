//#FILE: test-worker-esm-exit.js
//#SHA1: 0a8390d813ebf15b23dd3bbbdfcfd4196f17b514
//-----------------
"use strict";

const path = require("path");
const { Worker } = require("worker_threads");

const fixturesPath = path.resolve(__dirname, "..", "fixtures");

test("Worker exits with correct code from ESM", () => {
  const w = new Worker(path.join(fixturesPath, "es-modules", "import-process-exit.mjs"));

  return new Promise(resolve => {
    w.on("error", () => {
      throw new Error("Worker should not emit error");
    });

    w.on("exit", code => {
      expect(code).toBe(42);
      resolve();
    });
  });
});

//<#END_FILE: test-worker-esm-exit.js
