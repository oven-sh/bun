// Regression test for issue #22082
// https://github.com/oven-sh/bun/issues/22082
// Crash on ollama.generate due to Windows path buffer overflow
// The fix gracefully handles buffer overflow by falling back to regular path conversion
import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";
import { resolve } from "node:path";
import { promises as fs } from "node:fs";

test("Windows path handling doesn't crash with long paths", async () => {
  // Create a temp directory with a nested structure to simulate long paths
  const dir = tempDirWithFiles("22082-path-test", {
    "nested/deep/directory/structure/with/many/levels/file.txt": "test content",
  });

  // Test path resolution that could trigger the buffer overflow
  const longPath = resolve(
    dir,
    "nested",
    "deep",
    "directory",
    "structure",
    "with",
    "many",
    "levels",
    "file.txt"
  );

  // This should not crash - it may fail to access the file, but it shouldn't panic
  try {
    await fs.access(longPath);
    // File exists, good
  } catch (error) {
    // File doesn't exist or access failed, but we should not crash
    expect(error).toBeDefined();
  }

  // Test with an artificially long path that could cause overflow
  const veryLongPath = resolve(
    dir,
    "very".repeat(100),
    "long".repeat(100),
    "path".repeat(100),
    "that".repeat(100),
    "could".repeat(100),
    "cause".repeat(100),
    "buffer".repeat(100),
    "overflow.txt"
  );

  // This should also not crash
  try {
    await fs.access(veryLongPath);
    // Unlikely to exist, but if it does, that's fine
  } catch (error) {
    // Expected to fail, but should not crash
    expect(error).toBeDefined();
  }

  // Test fs.existsSync which was used in the ollama package
  expect(() => {
    require("node:fs").existsSync(longPath);
  }).not.toThrow();

  expect(() => {
    require("node:fs").existsSync(veryLongPath);  
  }).not.toThrow();
});

// Test simulating the ollama package usage pattern
test("ollama-like path handling doesn't crash", async () => {
  const dir = tempDirWithFiles("22082-ollama-test", {
    "image.jpg": "fake image data",
  });

  // Simulate what ollama's encodeImage function does
  async function simulateOllamaEncodeImage(imagePath: string): Promise<string> {
    if (typeof imagePath !== "string") {
      return Buffer.from(imagePath).toString("base64");
    }
    
    try {
      // This is the path resolution that triggered the crash
      const resolvedPath = resolve(imagePath);
      
      if (require("node:fs").existsSync(resolvedPath)) {
        // Read and convert to base64
        const fileBuffer = await fs.readFile(resolvedPath);
        return Buffer.from(fileBuffer).toString("base64");
      }
    } catch (error) {
      // Continue if there's an error
    }
    
    // Assume it's already base64
    return imagePath;
  }

  const imagePath = resolve(dir, "image.jpg");
  
  // This should not crash
  const result = await simulateOllamaEncodeImage(imagePath);
  expect(result).toBeDefined();
  expect(typeof result).toBe("string");
  
  // Test with a very long path
  const longImagePath = resolve(dir, "very".repeat(50) + "long".repeat(50) + "image.jpg");
  
  // This should also not crash
  const longResult = await simulateOllamaEncodeImage(longImagePath);
  expect(longResult).toBeDefined();
  expect(typeof longResult).toBe("string");
});