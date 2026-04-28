import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";

// This test verifies the fix for issue #24135:
// Bun.secrets.get on Windows returns strings with null bytes when credentials
// are stored via Windows Credential Manager UI (which uses UTF-16LE encoding).

describe.skipIf(!isWindows)("issue #24135", () => {
  test("Bun.secrets.get should not return null bytes for ASCII passwords", async () => {
    const testService = "bun-test-issue-24135-" + Date.now();
    const testUser = "test-name";
    const testPassword = "test123";

    try {
      // Set a credential via Bun (stores as UTF-8)
      await Bun.secrets.set({
        service: testService,
        name: testUser,
        value: testPassword,
      });

      // Retrieve and verify no null bytes
      const result = await Bun.secrets.get({ service: testService, name: testUser });
      expect(result).not.toBeNull();

      // The key test: verify there are no null bytes in the result
      const hasNullBytes = result!.includes("\0");
      expect(hasNullBytes).toBe(false);

      // Verify the actual value
      expect(result).toBe(testPassword);

      // Verify char codes don't have nulls interleaved
      const charCodes = Array.from(result!).map(c => c.charCodeAt(0));
      expect(charCodes).toEqual([116, 101, 115, 116, 49, 50, 51]); // "test123"
    } finally {
      // Clean up
      await Bun.secrets.delete({ service: testService, name: testUser });
    }
  });

  test("Bun.secrets.get should correctly decode unicode passwords", async () => {
    const testService = "bun-test-issue-24135-unicode-" + Date.now();
    const testUser = "test-name";
    const testPassword = "пароль密码🔐"; // Russian + Chinese + emoji

    try {
      await Bun.secrets.set({
        service: testService,
        name: testUser,
        value: testPassword,
      });

      const result = await Bun.secrets.get({ service: testService, name: testUser });
      expect(result).toBe(testPassword);

      // Verify no unexpected null bytes (nulls should not appear in UTF-8 encoded text)
      // Note: null bytes can legitimately appear in some encodings, but not in our test string
      const unexpectedNulls = result!.includes("\0");
      expect(unexpectedNulls).toBe(false);
    } finally {
      await Bun.secrets.delete({ service: testService, name: testUser });
    }
  });

  // This test simulates what happens when a credential is stored via Windows Credential Manager UI
  // by using cmdkey which also stores credentials in UTF-16LE format
  test("Bun.secrets.get should handle credentials stored via cmdkey (UTF-16LE)", async () => {
    const testService = "bun-test-issue-24135-cmdkey";
    const testUser = "cmdkey-test";
    const testPassword = "mypassword123";
    const targetName = `${testService}/${testUser}`;

    // Clean up any existing credential first
    await Bun.$`cmdkey /delete:${targetName}`.quiet().nothrow();

    try {
      // Store credential using cmdkey (stores as UTF-16LE, same as Windows Credential Manager UI)
      const addResult = await Bun.$`cmdkey /generic:${targetName} /user:${testUser} /pass:${testPassword}`
        .quiet()
        .nothrow();

      if (addResult.exitCode !== 0) {
        // cmdkey might not be available or may require elevated privileges
        // Skip this test if we can't add the credential
        console.log("Skipping cmdkey test - could not add credential");
        return;
      }

      // Now read it back via Bun.secrets
      const result = await Bun.secrets.get({ service: testService, name: testUser });

      // The key assertion: the result should NOT have null bytes interleaved
      expect(result).not.toBeNull();
      expect(result!.includes("\0")).toBe(false);
      expect(result).toBe(testPassword);
    } finally {
      // Clean up using cmdkey
      await Bun.$`cmdkey /delete:${targetName}`.quiet().nothrow();
    }
  });
});
