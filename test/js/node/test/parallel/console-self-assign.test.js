//#FILE: test-console-self-assign.js
//#SHA1: 7ed2fd07a18f0485f2592ada8e97e9c33753e691
//-----------------
"use strict";

// Assigning to itself should not throw.
test("console self-assignment", () => {
  expect(() => {
    global.console = global.console; // eslint-disable-line no-self-assign
  }).not.toThrow();
});

//<#END_FILE: test-console-self-assign.js
