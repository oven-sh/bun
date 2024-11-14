//#FILE: test-kill-segfault-freebsd.js
//#SHA1: ac3b65d8e5e92ffb9714307d2249b4c3b9240ed9
//-----------------
"use strict";

// This test ensures Node.js doesn't crash on hitting Ctrl+C in order to
// terminate the currently running process (especially on FreeBSD).
// https://github.com/nodejs/node-v0.x-archive/issues/9326

const child_process = require("child_process");

test("Node.js doesn't crash on SIGINT (FreeBSD issue)", done => {
  // NOTE: Was crashing on FreeBSD
  const cp = child_process.spawn(process.execPath, ["-e", 'process.kill(process.pid, "SIGINT")']);

  cp.on("exit", function (code) {
    expect(code).not.toBe(0);
    done();
  });
});

//<#END_FILE: test-kill-segfault-freebsd.js
