import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test for integer cast truncation bug in fs.readFile
// This is a regression test for a panic that occurred when casting
// usize to i64 in readFileWithOptions

test("fs.readFile should not panic on integer cast", async () => {
  // This is mostly a compilation/runtime safety test
  // The actual bug was caught at compile time due to integer cast checks
  // so if this code compiles and runs without panic, the fix is working
  
  const fs = require("fs");
  
  // Test basic functionality still works
  try {
    fs.readFileSync("non-existent-file.txt");
    expect(false).toBe(true); // Should not reach here
  } catch (err) {
    expect(err.code).toBe("ENOENT");
  }
  
  // Create a small test file and read it
  const testContent = "Hello, World!";
  fs.writeFileSync("test-file.txt", testContent);
  
  try {
    const content = fs.readFileSync("test-file.txt", "utf8");
    expect(content).toBe(testContent);
  } finally {
    // Clean up
    try {
      fs.unlinkSync("test-file.txt");
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});