import { expect, test } from "bun:test";

test("Error.prepareStackTrace should not have empty filenames", () => {
  let capturedStack: any[] = [];

  const originalPrepareStackTrace = Error.prepareStackTrace;

  try {
    Error.prepareStackTrace = function (error, stack) {
      capturedStack = stack;
      return error.toString();
    };

    // Create an error to capture the stack trace
    const err = new Error("test");
    err.stack; // Trigger prepareStackTrace

    // Verify that all frames have non-empty filenames
    for (const frame of capturedStack) {
      const filename = frame.getFileName();

      // The filename should never be an empty string
      // It can be null/undefined, or a meaningful value like "[unknown]" or a file path
      if (filename !== null && filename !== undefined) {
        expect(filename).not.toBe("");
      }
    }
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
});

test("bindings package use case: finding caller module", () => {
  let capturedStack: any[] = [];

  const originalPrepareStackTrace = Error.prepareStackTrace;

  try {
    Error.prepareStackTrace = function (error, stack) {
      capturedStack = stack;
      return error.toString();
    };

    function simulateBindingsPackageLogic() {
      const err = new Error();
      err.stack; // Trigger prepareStackTrace

      // This simulates what the bindings package does
      // It looks for the first non-empty filename to determine the calling module
      let callerFile = null;
      for (const frame of capturedStack) {
        const filename = frame.getFileName();
        if (filename && filename !== "") {
          callerFile = filename;
          break;
        }
      }

      return callerFile;
    }

    const result = simulateBindingsPackageLogic();

    // The bindings package should be able to find a caller file
    // It should not get confused by empty strings
    expect(result).toBeTruthy();

    // Verify none of the filenames are empty strings
    for (const frame of capturedStack) {
      const filename = frame.getFileName();
      if (filename !== null && filename !== undefined) {
        expect(filename).not.toBe("");
      }
    }
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
});
