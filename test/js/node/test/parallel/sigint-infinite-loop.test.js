//#FILE: test-sigint-infinite-loop.js
//#SHA1: 9c59ace1c99605bce14768e06d62a29e254e6116
//-----------------
"use strict";
// This test is to assert that we can SIGINT a script which loops forever.
// Ref(http):
// groups.google.com/group/nodejs-dev/browse_thread/thread/e20f2f8df0296d3f
const { spawn } = require("child_process");

test("SIGINT can kill an infinite loop", async () => {
  console.log("start");

  const c = spawn(process.execPath, ["-e", 'while(true) { console.log("hi"); }']);

  let sentKill = false;

  c.stdout.on("data", function (s) {
    // Prevent race condition:
    // Wait for the first bit of output from the child process
    // so that we're sure that it's in the V8 event loop and not
    // just in the startup phase of execution.
    if (!sentKill) {
      c.kill("SIGINT");
      console.log("SIGINT infinite-loop.js");
      sentKill = true;
    }
  });

  await new Promise(resolve => {
    c.on("exit", code => {
      expect(code).not.toBe(0);
      console.log("killed infinite-loop.js");
      resolve();
    });
  });

  expect(sentKill).toBe(true);
});

//<#END_FILE: test-sigint-infinite-loop.js
