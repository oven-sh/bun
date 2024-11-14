//#FILE: test-worker-nested-uncaught.js
//#SHA1: 948558ccf744615abbd0df028a83b36d36ad7aff
//-----------------
"use strict";
const { Worker } = require("worker_threads");

// Regression test for https://github.com/nodejs/node/issues/34309

test("nested worker uncaught error", done => {
  const w = new Worker(
    `const { Worker } = require('worker_threads');
    new Worker("throw new Error('uncaught')", { eval:true })`,
    { eval: true },
  );

  w.on("error", error => {
    expect(error).toEqual(
      expect.objectContaining({
        name: "Error",
        message: expect.any(String),
      }),
    );
    done();
  });
});

//<#END_FILE: test-worker-nested-uncaught.js
