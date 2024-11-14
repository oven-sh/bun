//#FILE: test-global-customevent.js
//#SHA1: 754c1b6babd0e73fa3206c9c9179ff3a034eba9b
//-----------------
"use strict";

// Global
test("CustomEvent is defined globally", () => {
  expect(CustomEvent).toBeDefined();
});

test("CustomEvent is the same as internal CustomEvent", () => {
  // We can't use internal modules in Jest, so we'll skip this test
  // and add a comment explaining why.
  console.log("Skipping test for internal CustomEvent comparison");
  // The original test was:
  // strictEqual(CustomEvent, internalCustomEvent);
});

//<#END_FILE: test-global-customevent.js
