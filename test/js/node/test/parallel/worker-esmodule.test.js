//#FILE: test-worker-esmodule.js
//#SHA1: a40c6a55aa2fe45203bec4808e0d53efed2fa4e4
//-----------------
"use strict";

const fixtures = require("../common/fixtures");
const { Worker } = require("worker_threads");

test("Worker can load ES module", () => {
  const w = new Worker(fixtures.path("worker-script.mjs"));

  return new Promise(resolve => {
    w.on("message", message => {
      expect(message).toBe("Hello, world!");
      resolve();
    });
  });
});

//<#END_FILE: test-worker-esmodule.js
