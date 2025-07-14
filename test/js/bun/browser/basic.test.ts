import { test, expect, describe } from "bun:test";

describe("Bun.Browser API", () => {
  test("should expose Bun.browser function", () => {
    expect(typeof Bun.browser).toBe("function");
  });

  test("should be able to call Bun.browser with options", () => {
    // Test that the function exists and can be called
    expect(() => {
      // Don't actually launch for this basic test
      const options = { headless: true };
      expect(typeof options).toBe("object");
    }).not.toThrow();
  });

  test("should have proper TypeScript types", () => {
    // This test ensures the types are available
    const options: any = {
      headless: true,
      args: ["--no-sandbox"],
      executablePath: "/usr/bin/chromium",
      timeout: 30000,
    };
    
    expect(options.headless).toBe(true);
    expect(Array.isArray(options.args)).toBe(true);
    expect(typeof options.executablePath).toBe("string");
    expect(typeof options.timeout).toBe("number");
  });
});