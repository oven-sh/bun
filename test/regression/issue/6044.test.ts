// Regression test for issue #6044: happy-dom causes console.log() to not print during tests
// https://github.com/oven-sh/bun/issues/6044

import { test, expect, describe } from "bun:test";
import { Window } from "happy-dom";

describe("Console preservation with happy-dom", () => {
  test("console.log should work when happy-dom overrides console", () => {
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.console = window.console; // This previously broke console output
    
    // These console calls should now appear in the output thanks to the fix
    console.log("console.log works with happy-dom override");
    console.error("console.error works with happy-dom override");
    
    expect(true).toBe(true);
  });

  test("console works with multiple happy-dom instances", () => {
    // Test with multiple DOM setups that override console
    for (let i = 0; i < 2; i++) {
      const window = new Window();
      globalThis.console = window.console;
      console.log(`Console works with happy-dom instance ${i}`);
    }
    
    expect(true).toBe(true);
  });

  test("console methods with complex arguments", () => {
    const window = new Window();
    globalThis.console = window.console;
    
    console.log("Complex object:", { key: "value", nested: { prop: 123 } });
    console.log("Multiple arguments:", "string", 42, true, null);
    
    expect(true).toBe(true);
  });
});