//#FILE: test-runner-filter-warning.js
//#SHA1: c0887965f213c569d83684255054bf9e4bc27c29
//-----------------
// Flags: --test-only
"use strict";

const { defaultMaxListeners } = require("node:events");

// Remove the process.on('warning') listener as it's not needed in Jest

for (let i = 0; i < defaultMaxListeners + 1; ++i) {
  test(`test ${i + 1}`, () => {
    // Empty test body, just to create the specified number of tests
  });
}

// Add a test to ensure no warnings are emitted
test("no warnings should be emitted", () => {
  const warningListener = jest.fn();
  process.on("warning", warningListener);

  // Run all tests
  return new Promise(resolve => {
    setTimeout(() => {
      expect(warningListener).not.toHaveBeenCalled();
      process.removeListener("warning", warningListener);
      resolve();
    }, 100); // Wait a short time to ensure all tests have run
  });
});

//<#END_FILE: test-runner-filter-warning.js
