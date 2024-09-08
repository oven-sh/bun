//#FILE: test-process-abort.js
//#SHA1: ca6e85cb79ad3e78182547bd6be24625268aced4
//-----------------
"use strict";

// Skip this test in Workers as process.abort() is not available
if (typeof Worker !== "undefined") {
  test.skip("process.abort() is not available in Workers", () => {});
} else {
  describe("process.abort", () => {
    test("should not have a prototype", () => {
      expect(process.abort.prototype).toBeUndefined();
    });

    test("should throw TypeError when instantiated", () => {
      expect(() => new process.abort()).toThrow(TypeError);
    });
  });
}

//<#END_FILE: test-process-abort.js
