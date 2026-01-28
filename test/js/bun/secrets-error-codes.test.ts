import { describe, expect, test } from "bun:test";
import { isCI, isMacOS, isWindows } from "harness";

describe.todoIf(isCI && !isWindows)("Bun.secrets error codes", () => {
  test("non-existent secret returns null without error", async () => {
    const result = await Bun.secrets.get({
      service: "non-existent-service-" + Date.now(),
      name: "non-existent-name",
    });

    expect(result).toBeNull();
  });

  test("delete non-existent returns false without error", async () => {
    const result = await Bun.secrets.delete({
      service: "non-existent-service-" + Date.now(),
      name: "non-existent-name",
    });

    expect(result).toBe(false);
  });

  test("invalid arguments throw with proper error codes", async () => {
    // Missing service
    try {
      // @ts-expect-error
      await Bun.secrets.get({ name: "test" });
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
      expect(error.message).toContain("Expected service and name to be strings");
    }

    // Empty service
    try {
      await Bun.secrets.get({ service: "", name: "test" });
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
      expect(error.message).toContain("Expected service and name to not be empty");
    }

    // Missing value in set
    try {
      // @ts-expect-error
      await Bun.secrets.set({ service: "test", name: "test" });
      expect.unreachable();
    } catch (error: any) {
      expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
      expect(error.message).toContain("Expected 'value' to be a string");
    }
  });

  test("successful operations work correctly", async () => {
    const service = "bun-test-codes-" + Date.now();
    const name = "test-name";
    const value = "test-password";

    // Set a secret
    await Bun.secrets.set({ service, name, value, allowUnrestrictedAccess: isMacOS });

    // Get it back
    const retrieved = await Bun.secrets.get({ service, name });
    expect(retrieved).toBe(value);

    // Delete it
    const deleted = await Bun.secrets.delete({ service, name });
    expect(deleted).toBe(true);

    // Verify it's gone
    const afterDelete = await Bun.secrets.get({ service, name });
    expect(afterDelete).toBeNull();
  });

  test("error messages have no null bytes", async () => {
    // Test various error conditions
    const errorTests = [
      { service: "", name: "test" },
      { service: "test", name: "" },
    ];

    for (const testCase of errorTests) {
      try {
        await Bun.secrets.get(testCase);
        expect.unreachable();
      } catch (error: any) {
        // Check for null bytes
        expect(error.message).toBeDefined();
        expect(error.message.includes("\0")).toBe(false);

        // Check error has a code
        expect(error.code).toBeDefined();
        expect(typeof error.code).toBe("string");
      }
    }
  });
});
