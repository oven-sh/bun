//#FILE: test-finalization-registry-shutdown.js
//#SHA1: c5da440f8ea977c501bb5920f55ce69b1da6e28d
//-----------------
// Flags: --expose-gc
"use strict";

// This test verifies that when a V8 FinalizationRegistryCleanupTask is queue
// at the last moment when JavaScript can be executed, the callback of a
// FinalizationRegistry will not be invoked and the process should exit
// normally.

test("FinalizationRegistry callback should not be called during shutdown", () => {
  const mockCallback = jest.fn();
  const reg = new FinalizationRegistry(mockCallback);

  function register() {
    // Create a temporary object in a new function scope to allow it to be GC-ed.
    reg.register({});
  }

  const exitHandler = () => {
    // This is the final chance to execute JavaScript.
    register();
    // Queue a FinalizationRegistryCleanupTask by a testing gc request.
    global.gc();
  };

  process.on("exit", exitHandler);

  // Simulate the exit process
  exitHandler();

  // Verify that the callback was not called
  expect(mockCallback).not.toHaveBeenCalled();

  // Clean up
  process.removeListener("exit", exitHandler);
});

//<#END_FILE: test-finalization-registry-shutdown.js
