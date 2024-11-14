//#FILE: test-tty-stdin-end.js
//#SHA1: 66243635acf852b7a108d06e289e5db2b2573bad
//-----------------
"use strict";

// This test ensures that Node.js doesn't crash on `process.stdin.emit("end")`.
// https://github.com/nodejs/node/issues/1068

test("process.stdin.emit('end') doesn't crash", () => {
  expect(() => {
    process.stdin.emit("end");
  }).not.toThrow();
});

//<#END_FILE: test-tty-stdin-end.js
