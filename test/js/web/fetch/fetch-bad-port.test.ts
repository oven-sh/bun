import { test, expect } from "bun:test";

test("fetch should block bad ports", async () => {
  // Test a few known bad ports
  const badPorts = [1, 7, 9, 21, 22, 23, 25, 6000];

  for (const port of badPorts) {
    try {
      await fetch(`http://localhost:${port}/`);
      throw new Error(`Expected fetch to localhost:${port} to fail, but it succeeded`);
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe("fetch failed");
      expect(error.cause).toBeDefined();
      expect(error.cause.message).toBe("bad port");
    }
  }
});

test("fetch should allow good ports", async () => {
  // These ports should be allowed (but might fail to connect)
  const goodPorts = [80, 443, 8080, 3000];

  for (const port of goodPorts) {
    try {
      await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(100),
      });
    } catch (error) {
      // We expect connection errors, but not "bad port" errors
      expect(error.cause?.message).not.toBe("bad port");
    }
  }
});
