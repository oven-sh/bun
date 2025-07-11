import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { tempDirWithFiles, tmpdirSync } from "harness";
import { join } from "path";
import { rmSync, existsSync } from "fs";

describe("Bun file I/O", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = tmpdirSync();
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("Bun.file() can read text files", async () => {
    const dir = tempDirWithFiles("file-read-test", {
      "test.txt": "Hello, World!",
    });

    const file = Bun.file(join(dir, "test.txt"));
    const content = await file.text();
    
    expect(content).toBe("Hello, World!");
  });

  test("Bun.file() can read JSON files", async () => {
    const testData = { message: "Hello", number: 42, array: [1, 2, 3] };
    const dir = tempDirWithFiles("json-read-test", {
      "data.json": JSON.stringify(testData),
    });

    const file = Bun.file(join(dir, "data.json"));
    const data = await file.json();
    
    expect(data).toEqual(testData);
  });

  test("Bun.file() can get file size", async () => {
    const content = "This is a test file";
    const dir = tempDirWithFiles("size-test", {
      "test.txt": content,
    });

    const file = Bun.file(join(dir, "test.txt"));
    
    expect(file.size).toBe(content.length);
  });

  test("Bun.file() can check if file exists", async () => {
    const dir = tempDirWithFiles("exists-test", {
      "existing.txt": "I exist!",
    });

    const existingFile = Bun.file(join(dir, "existing.txt"));
    const nonExistentFile = Bun.file(join(dir, "nonexistent.txt"));
    
    expect(await existingFile.exists()).toBe(true);
    expect(await nonExistentFile.exists()).toBe(false);
  });

  test("Bun.write() can write text to files", async () => {
    const filePath = join(tempDir, "write-test.txt");
    const content = "Written by Bun!";

    await Bun.write(filePath, content);
    
    const file = Bun.file(filePath);
    expect(await file.exists()).toBe(true);
    expect(await file.text()).toBe(content);
  });

  test("Bun.write() can write JSON to files", async () => {
    const filePath = join(tempDir, "write-json.json");
    const data = { name: "Bun", version: "1.0", features: ["fast", "easy"] };

    await Bun.write(filePath, JSON.stringify(data, null, 2));
    
    const file = Bun.file(filePath);
    const readData = await file.json();
    expect(readData).toEqual(data);
  });

  test("Bun.write() can write binary data", async () => {
    const filePath = join(tempDir, "binary-test.bin");
    const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello" in bytes

    await Bun.write(filePath, buffer);
    
    const file = Bun.file(filePath);
    const readBuffer = await file.arrayBuffer();
    expect(new Uint8Array(readBuffer)).toEqual(buffer);
  });

  test("Bun.file() can read as ArrayBuffer", async () => {
    const dir = tempDirWithFiles("buffer-test", {
      "data.txt": "Buffer content",
    });

    const file = Bun.file(join(dir, "data.txt"));
    const buffer = await file.arrayBuffer();
    
    expect(buffer instanceof ArrayBuffer).toBe(true);
    expect(buffer.byteLength).toBe("Buffer content".length);
    
    // Convert back to string to verify content
    const decoder = new TextDecoder();
    expect(decoder.decode(buffer)).toBe("Buffer content");
  });

  test("Bun.file() has correct MIME type detection", async () => {
    const dir = tempDirWithFiles("mime-test", {
      "test.txt": "text content",
      "data.json": '{"key": "value"}',
      "style.css": "body { color: red; }",
    });

    const txtFile = Bun.file(join(dir, "test.txt"));
    const jsonFile = Bun.file(join(dir, "data.json"));
    const cssFile = Bun.file(join(dir, "style.css"));
    
    expect(txtFile.type).toBe("text/plain");
    expect(jsonFile.type).toBe("application/json");
    expect(cssFile.type).toBe("text/css");
  });

  test("Bun.file() can handle large files efficiently", async () => {
    const filePath = join(tempDir, "large-file.txt");
    
    // Create a reasonably large string (1MB)
    const largeContent = "A".repeat(1024 * 1024);
    await Bun.write(filePath, largeContent);
    
    const start = performance.now();
    const file = Bun.file(filePath);
    const content = await file.text();
    const end = performance.now();
    
    expect(content.length).toBe(1024 * 1024);
    expect(content).toBe(largeContent);
    // Should be fast (less than 1 second)
    expect(end - start).toBeLessThan(1000);
  });

  test("Bun.write() overwrites existing files", async () => {
    const filePath = join(tempDir, "overwrite-test.txt");
    
    await Bun.write(filePath, "Original content");
    expect(await Bun.file(filePath).text()).toBe("Original content");
    
    await Bun.write(filePath, "New content");
    expect(await Bun.file(filePath).text()).toBe("New content");
  });

  test("Bun.file() handles empty files", async () => {
    const dir = tempDirWithFiles("empty-test", {
      "empty.txt": "",
    });

    const file = Bun.file(join(dir, "empty.txt"));
    
    expect(file.size).toBe(0);
    expect(await file.text()).toBe("");
    expect(await file.exists()).toBe(true);
  });
});