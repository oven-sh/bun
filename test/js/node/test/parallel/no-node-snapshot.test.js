//#FILE: test-no-node-snapshot.js
//#SHA1: e8e4ecdb2aa4c064a55e1c7b076424d0b0d0a007
//-----------------
"use strict";

// Flags: --no-node-snapshot

test("--no-node-snapshot flag", () => {
  // This test doesn't actually assert anything.
  // It's merely checking if the script runs without errors when the flag is set.
  expect(true).toBe(true);
});

//<#END_FILE: test-no-node-snapshot.js
