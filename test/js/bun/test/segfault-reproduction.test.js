import { test, expect } from "bun:test";

test("reproduction: segfault with async test + setTimeout + Error.prepareStackTrace", async () => {
  // Set up Error.prepareStackTrace to be involved in stack trace capture
  const originalPrepareStackTrace = Error.prepareStackTrace;
  
  Error.prepareStackTrace = function(error, stack) {
    // This function will be called when capturing stack traces
    // The segfault appears to happen when this is called during
    // unhandled promise rejection handling after the test finishes
    return originalPrepareStackTrace ? originalPrepareStackTrace(error, stack) : error.stack;
  };

  // The test itself should complete normally
  await new Promise(resolve => {
    setTimeout(resolve, 10);
  });
  
  expect(true).toBe(true);
  
  // This setTimeout should fire AFTER the test completes
  // and throw an unhandled exception while Error.prepareStackTrace is active
  setTimeout(() => {
    // Create an error that will trigger stack trace capture
    const error = new Error("Unhandled exception after test completion");
    
    // Force stack trace capture which should trigger Error.prepareStackTrace
    Error.captureStackTrace(error);
    
    // This should cause an unhandled promise rejection
    Promise.reject(error);
    
    // Also throw directly to maximize chances of hitting the problematic code path
    throw error;
  }, 50); // Wait longer than the test duration to ensure test has finished
  
  // Don't restore Error.prepareStackTrace immediately - let it stay active
  // when the setTimeout fires
});

test("additional reproduction attempt with promise rejection", async () => {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  
  // Different approach - make Error.prepareStackTrace do something that might be problematic
  Error.prepareStackTrace = function(error, stack) {
    // Try to access stack frames in a way that might cause issues
    if (stack && stack.length > 0) {
      try {
        stack.forEach(frame => {
          if (frame && typeof frame.getFileName === 'function') {
            frame.getFileName();
            frame.getLineNumber();
            frame.getFunctionName();
          }
        });
      } catch (e) {
        // Ignore errors in stack processing
      }
    }
    return originalPrepareStackTrace ? originalPrepareStackTrace(error, stack) : error.stack;
  };

  // Test completes normally
  await Promise.resolve();
  expect(true).toBe(true);
  
  // Schedule unhandled rejection after test completion
  setTimeout(() => {
    // Create error and immediately access stack property to trigger prepareStackTrace
    const error = new Error("Post-test unhandled rejection");
    const stack = error.stack; // This should trigger Error.prepareStackTrace
    
    // Create unhandled promise rejection
    Promise.reject(new Error("Unhandled rejection with stack trace: " + stack));
  }, 100);
});

test("variation 3: nested setTimeout with promise chain", async () => {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  
  Error.prepareStackTrace = function(error, stack) {
    // Attempt to trigger the problematic remapZigException path
    if (stack) {
      stack.forEach(frame => {
        try {
          frame.toString();
        } catch (e) {
          // Ignore
        }
      });
    }
    return error.name + ": " + error.message;
  };

  // Test passes normally
  expect(true).toBe(true);
  
  // Multiple layers of async operations after test completion
  setTimeout(() => {
    setTimeout(() => {
      const error = new Error("Deep async error");
      error.stack; // Trigger prepareStackTrace
      
      // Chain of promise rejections
      Promise.reject(error).catch(() => {
        Promise.reject(new Error("Secondary rejection"));
      });
    }, 20);
  }, 80);
});

test("variation 4: direct unhandled rejection in microtask", async () => {
  const originalPrepareStackTrace = Error.prepareStackTrace;
  
  Error.prepareStackTrace = function(error, stack) {
    // This might be called during the error handling that causes the segfault
    return originalPrepareStackTrace ? originalPrepareStackTrace(error, stack) : `${error.name}: ${error.message}`;
  };
  
  expect(true).toBe(true);
  
  // Use queueMicrotask to ensure this runs after test completion
  queueMicrotask(() => {
    setTimeout(() => {
      const error = new Error("Microtask unhandled error");
      
      // Multiple ways to trigger stack trace capture
      Error.captureStackTrace(error);
      const stack = error.stack;
      
      // Unhandled rejection that should go through TestRunnerTask.onUnhandledRejection
      Promise.reject(error);
      
      // Also throw to cover multiple error paths
      throw new Error("Direct throw: " + stack);
    }, 60);
  });
});