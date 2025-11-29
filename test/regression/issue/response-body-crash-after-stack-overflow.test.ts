import { test } from "bun:test";

// Fixes: ENG-23921
// Accessing Response.json().body after catching a stack overflow exception
// should not crash the runtime.
test(
  "Response.json().body should not crash after catching stack overflow",
  () => {
    function F0() {
      if (!new.target) {
        throw "must be called with new";
      }
      const v3 = this.constructor;
      try {
        new v3();
      } catch (e) {}
      // This should not crash - it used to trigger an assertion failure
      // due to a pending exception not being properly handled
      Response.json().body;
    }
    // This should not crash
    new F0();
  },
  { timeout: 60000 },
);
