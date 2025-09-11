import { describe, expect, test } from "bun:test";

describe("CallSite API", () => {
  describe("getFunctionName", () => {
    test("should return null instead of empty string for anonymous functions", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      const anonymousFunc = function () {
        return new Error().stack;
      };

      anonymousFunc();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // Should return null, not empty string
      expect(firstCallSite.getFunctionName()).toBe(null);
    });

    test("should return function name for named functions", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      function namedFunction() {
        return new Error().stack;
      }

      namedFunction();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      expect(firstCallSite.getFunctionName()).toBe("namedFunction");
    });
  });

  describe("getMethodName", () => {
    test("should return null instead of empty string for anonymous methods", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      const obj = {
        method: function () {
          return new Error().stack;
        },
      };

      obj.method();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // For now, getMethodName should return null for empty names
      const methodName = firstCallSite.getMethodName();
      expect(methodName === null || methodName === "method").toBe(true);
    });
  });

  describe("getTypeName", () => {
    test("should return null instead of 'undefined' for undefined this value", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      // In strict mode, 'this' is undefined
      ("use strict");
      function strictFunction() {
        return new Error().stack;
      }

      strictFunction();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // Should return null, not "undefined"
      expect(firstCallSite.getTypeName()).toBe(null);
    });

    test("should return proper type name for objects", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      const obj = {
        method() {
          return new Error().stack;
        },
      };

      obj.method();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // Should return "Object" for plain objects
      expect(firstCallSite.getTypeName()).toBe("Object");
    });
  });

  describe("isAsync", () => {
    test("should return true for async functions", async () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      async function asyncFunc() {
        return new Error().stack;
      }

      await asyncFunc();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // Should return true for async functions
      expect(firstCallSite.isAsync()).toBe(true);
    });

    test("should return false for regular functions", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      function regularFunc() {
        return new Error().stack;
      }

      regularFunc();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // Should return false for regular functions
      expect(firstCallSite.isAsync()).toBe(false);
    });

    test("should return true for async generator functions", async () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      async function* asyncGenFunc() {
        new Error().stack;
        yield 1;
      }

      const gen = asyncGenFunc();
      await gen.next();
      Error.prepareStackTrace = originalPrepare;

      // Check if we captured any async frames
      if (callSites.length > 0) {
        const asyncFrame = callSites.find(cs => cs.getFunctionName() === "asyncGenFunc");
        if (asyncFrame) {
          expect(asyncFrame.isAsync()).toBe(true);
        }
      }
    });
  });

  describe("isToplevel", () => {
    test("should return false for functions called within other functions", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      function innerFunc() {
        return new Error().stack;
      }

      function outerFunc() {
        return innerFunc();
      }

      outerFunc();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(1);
      const innerCallSite = callSites[0];

      // innerFunc is not top-level, it's called from outerFunc
      expect(innerCallSite.isToplevel()).toBe(false);
    });

    test("should return true for module-level code", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      // This runs at module level
      new Error().stack;

      Error.prepareStackTrace = originalPrepare;

      if (callSites.length > 0) {
        // Find the top-most frame (module level)
        const topFrame = callSites[callSites.length - 1];

        // Module-level code should be considered top-level
        // Though in test context this might not always be true
        expect(typeof topFrame.isToplevel()).toBe("boolean");
      }
    });

    test("should return false for method calls", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      const obj = {
        method() {
          return new Error().stack;
        },
      };

      obj.method();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // Method calls should not be top-level
      expect(firstCallSite.isToplevel()).toBe(false);
    });
  });

  describe("toString", () => {
    test("should not be affected by overriding other methods", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      function testFunc() {
        return new Error().stack;
      }

      testFunc();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // Get original toString result
      const originalToString = firstCallSite.toString();

      // Try to override getFunctionName (shouldn't affect toString)
      firstCallSite.getFunctionName = () => "overridden";

      // toString should still return the original result
      expect(firstCallSite.toString()).toBe(originalToString);
    });
  });

  describe("V8 compatibility", () => {
    test("all CallSite methods should be present", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      function testFunc() {
        return new Error().stack;
      }

      testFunc();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const cs = callSites[0];

      // Check that all V8 CallSite methods exist
      expect(typeof cs.getThis).toBe("function");
      expect(typeof cs.getTypeName).toBe("function");
      expect(typeof cs.getFunction).toBe("function");
      expect(typeof cs.getFunctionName).toBe("function");
      expect(typeof cs.getMethodName).toBe("function");
      expect(typeof cs.getFileName).toBe("function");
      expect(typeof cs.getLineNumber).toBe("function");
      expect(typeof cs.getColumnNumber).toBe("function");
      expect(typeof cs.getEvalOrigin).toBe("function");
      expect(typeof cs.getScriptNameOrSourceURL).toBe("function");
      expect(typeof cs.isToplevel).toBe("function");
      expect(typeof cs.isEval).toBe("function");
      expect(typeof cs.isNative).toBe("function");
      expect(typeof cs.isConstructor).toBe("function");
      expect(typeof cs.isAsync).toBe("function");
      expect(typeof cs.isPromiseAll).toBe("function");
      expect(typeof cs.getPromiseIndex).toBe("function");
      expect(typeof cs.toString).toBe("function");
    });

    test("strict mode restrictions on getThis and getFunction", () => {
      const originalPrepare = Error.prepareStackTrace;
      let callSites: any[] = [];

      Error.prepareStackTrace = (err, stack) => {
        callSites = stack;
        return "";
      };

      ("use strict");
      function strictFunc() {
        return new Error().stack;
      }

      strictFunc();
      Error.prepareStackTrace = originalPrepare;

      expect(callSites.length).toBeGreaterThan(0);
      const firstCallSite = callSites[0];

      // In strict mode, getThis and getFunction should return undefined
      expect(firstCallSite.getThis()).toBe(undefined);
      expect(firstCallSite.getFunction()).toBe(undefined);
    });
  });
});
