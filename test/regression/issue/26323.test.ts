import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("fs.readFileSync", () => {
  test("should throw catchable error for files exceeding string length limit with utf-8 encoding", async () => {
    // Create a file that exceeds the lowered string limit
    // We set BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT to 1000 bytes
    // and create a 2000 byte file, which should exceed the limit
    using dir = tempDir("readfile-string-limit", {
      "large.txt": "x".repeat(2000),
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("fs");
try {
  const content = fs.readFileSync("large.txt", "utf-8");
  console.log("ERROR: Should have thrown but got content length:", content.length);
  process.exit(1);
} catch (error) {
  console.log("Caught error:", error.code);
  process.exit(0);
}
`,
      ],
      env: {
        ...bunEnv,
        // BUN_GARBAGE_COLLECTOR_LEVEL must be set for BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT to be processed
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: "1000",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should exit cleanly with code 0 (caught the error)
    expect(stdout).toContain("Caught error: ENOMEM");
    expect(exitCode).toBe(0);
  });

  test("should throw catchable error for files exceeding string length limit with ascii encoding", async () => {
    using dir = tempDir("readfile-string-limit-ascii", {
      "large.txt": "x".repeat(2000),
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("fs");
try {
  const content = fs.readFileSync("large.txt", "ascii");
  console.log("ERROR: Should have thrown but got content length:", content.length);
  process.exit(1);
} catch (error) {
  console.log("Caught error:", error.code);
  process.exit(0);
}
`,
      ],
      env: {
        ...bunEnv,
        // BUN_GARBAGE_COLLECTOR_LEVEL must be set for BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT to be processed
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: "1000",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Caught error: ENOMEM");
    expect(exitCode).toBe(0);
  });

  test("should throw catchable error for hex encoding when output exceeds limit", async () => {
    // Hex encoding doubles the size: 600 bytes -> 1200 chars > 1000 limit
    using dir = tempDir("readfile-string-limit-hex", {
      "data.bin": "x".repeat(600),
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("fs");
try {
  const content = fs.readFileSync("data.bin", "hex");
  console.log("ERROR: Should have thrown but got content length:", content.length);
  process.exit(1);
} catch (error) {
  console.log("Caught error:", error.code);
  process.exit(0);
}
`,
      ],
      env: {
        ...bunEnv,
        // BUN_GARBAGE_COLLECTOR_LEVEL must be set for BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT to be processed
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: "1000",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Caught error: ENOMEM");
    expect(exitCode).toBe(0);
  });

  test("should allow reading files within the limit", async () => {
    using dir = tempDir("readfile-within-limit", {
      "small.txt": "x".repeat(500),
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("fs");
try {
  const content = fs.readFileSync("small.txt", "utf-8");
  console.log("Success: read", content.length, "chars");
  process.exit(0);
} catch (error) {
  console.log("ERROR: Unexpected error:", error.code);
  process.exit(1);
}
`,
      ],
      env: {
        ...bunEnv,
        // BUN_GARBAGE_COLLECTOR_LEVEL must be set for BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT to be processed
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: "1000",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Success: read 500 chars");
    expect(exitCode).toBe(0);
  });

  test("should allow reading files as buffer within the limit", async () => {
    // When reading as buffer (no encoding), the synthetic_allocation_limit is used
    // This test verifies that buffers within the limit can still be read
    using dir = tempDir("readfile-buffer-limit", {
      "data.bin": "x".repeat(500),
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const fs = require("fs");
try {
  const content = fs.readFileSync("data.bin");
  console.log("Success: read", content.length, "bytes as buffer");
  process.exit(0);
} catch (error) {
  console.log("ERROR: Unexpected error:", error.code);
  process.exit(1);
}
`,
      ],
      env: {
        ...bunEnv,
        // BUN_GARBAGE_COLLECTOR_LEVEL must be set for BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT to be processed
        BUN_GARBAGE_COLLECTOR_LEVEL: "0",
        BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: "1000",
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Success: read 500 bytes as buffer");
    expect(exitCode).toBe(0);
  });
});
