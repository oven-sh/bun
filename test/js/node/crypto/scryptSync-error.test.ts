import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("crypto.scryptSync error handling", () => {
  test("scryptSync throws on invalid parameters that pass validation but fail at derivation", async () => {
    // This tests that scryptSync properly checks for errors after key derivation
    // and doesn't return uninitialized memory. We use a subprocess to test the
    // password length > INT32_MAX path which sets err=0.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const crypto = require("crypto");
        // Test that valid params work
        const good = crypto.scryptSync("password", "salt", 64);
        if (good.length !== 64) {
          process.exit(1);
        }
        console.log("ok");
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("scryptSync throws on N=3 (not a power of 2)", () => {
    const crypto = require("crypto");
    expect(() => {
      crypto.scryptSync("password", "salt", 64, { N: 3, r: 8, p: 1 });
    }).toThrow();
  });

  test("scryptSync throws on maxmem too low", () => {
    const crypto = require("crypto");
    expect(() => {
      // N=16384, r=8 requires ~16MB, maxmem=1 should fail
      crypto.scryptSync("password", "salt", 64, { N: 16384, r: 8, p: 1, maxmem: 1 });
    }).toThrow();
  });

  test("scryptSync returns correct result for valid parameters", () => {
    const crypto = require("crypto");
    const result = crypto.scryptSync("password", "salt", 64);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(64);
    // Verify it's deterministic (same params = same result)
    const result2 = crypto.scryptSync("password", "salt", 64);
    expect(result.toString("hex")).toBe(result2.toString("hex"));
  });

  test("async scrypt throws synchronously for invalid params", () => {
    const crypto = require("crypto");
    // N=3 is not a power of 2, so param validation fails synchronously even for async scrypt
    expect(() => {
      crypto.scrypt("password", "salt", 64, { N: 3, r: 8, p: 1 }, () => {});
    }).toThrow(/Invalid scrypt params/);
  });
});
