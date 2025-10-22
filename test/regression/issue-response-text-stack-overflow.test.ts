// Test for: Response.text() causing assertion failure with stack overflow
// This test ensures that stack overflow exceptions during Response.text() calls
// are properly handled and don't trigger assertion failures in debug builds.

import { expect, test } from "bun:test";

test("Response.text() handles stack overflow exceptions correctly", () => {
  function f0(a1: Function, a2?: any): Promise<string> {
    const v4 = new Response();
    const v5 = v4.text();
    a1(a1); // Recursive call causes stack overflow
    return v5;
  }

  // This should throw a RangeError for stack overflow, not crash with assertion
  expect(() => f0(f0)).toThrow(RangeError);
});

test("Response.text() with moderate recursion works correctly", async () => {
  let depth = 0;
  const maxDepth = 100; // Moderate recursion that won't overflow

  async function f0(a1: Function): Promise<string> {
    depth++;
    if (depth > maxDepth) {
      throw new Error("Max depth reached");
    }

    const v4 = new Response("test content");
    const v5 = v4.text();

    try {
      await f0(a1);
    } catch (e: any) {
      if (e.message === "Max depth reached") {
        return v5;
      }
      throw e;
    }

    return v5;
  }

  const result = await f0(f0);
  expect(result).toBe("test content");
  expect(depth).toBe(maxDepth + 1);
});
