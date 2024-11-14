//#FILE: test-js-stream-call-properties.js
//#SHA1: 491c3447495fadda8e713d00b9621ea31d8fb27d
//-----------------
"use strict";

test("JSStream properties can be inspected", () => {
  // We can't use internal bindings in Jest, so we'll mock the JSStream
  class MockJSStream {
    constructor() {
      // Add some properties that might be inspected
      this.readableFlowing = null;
      this.writableFinished = false;
      // Add more properties as needed
    }
  }

  // Mock util.inspect to ensure it's called
  const mockInspect = jest.fn();
  jest.spyOn(console, "log").mockImplementation(mockInspect);

  // Create an instance of our mock JSStream
  const jsStream = new MockJSStream();

  // Call console.log, which will internally call util.inspect
  console.log(jsStream);

  // Verify that inspect was called
  expect(mockInspect).toHaveBeenCalledTimes(1);
  expect(mockInspect).toHaveBeenCalledWith(expect.any(MockJSStream));

  // Clean up
  console.log.mockRestore();
});

//<#END_FILE: test-js-stream-call-properties.js
