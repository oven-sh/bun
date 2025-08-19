import { test, expect } from "bun:test";

test("navigator.clipboard exists", () => {
  expect(navigator.clipboard).toBeDefined();
  expect(typeof navigator.clipboard).toBe("object");
});

test("navigator.clipboard has required methods", () => {
  expect(typeof navigator.clipboard.readText).toBe("function");
  expect(typeof navigator.clipboard.writeText).toBe("function");
  expect(typeof navigator.clipboard.read).toBe("function");
  expect(typeof navigator.clipboard.write).toBe("function");
});

test("writeText and readText work with strings", async () => {
  const testText = "Hello from Bun clipboard test!";
  
  // Write text to clipboard
  await navigator.clipboard.writeText(testText);
  
  // Read it back
  const result = await navigator.clipboard.readText();
  expect(result).toBe(testText);
});

test("writeText handles empty string", async () => {
  await navigator.clipboard.writeText("");
  const result = await navigator.clipboard.readText();
  expect(result).toBe("");
});

test("writeText handles unicode characters", async () => {
  const unicodeText = "Hello 世界 🌍 Bun! 🚀";
  
  await navigator.clipboard.writeText(unicodeText);
  const result = await navigator.clipboard.readText();
  expect(result).toBe(unicodeText);
});

test("write and read work with ClipboardItem containing text", async () => {
  const testText = "ClipboardItem test text";
  
  const clipboardItem = {
    "text/plain": testText
  };
  
  await navigator.clipboard.write([clipboardItem]);
  const result = await navigator.clipboard.read("text/plain");
  expect(result).toBe(testText);
});

test("write and read work with HTML content", async () => {
  const testHTML = "<p>Hello <strong>HTML</strong> clipboard!</p>";
  
  const clipboardItem = {
    "text/html": testHTML
  };
  
  await navigator.clipboard.write([clipboardItem]);
  const result = await navigator.clipboard.read("text/html");
  expect(result).toBe(testHTML);
});

test("writeText returns a Promise", () => {
  const promise = navigator.clipboard.writeText("test");
  expect(promise).toBeInstanceOf(Promise);
  return promise; // Let test wait for completion
});

test("readText returns a Promise", () => {
  const promise = navigator.clipboard.readText();
  expect(promise).toBeInstanceOf(Promise);
  return promise; // Let test wait for completion
});

test("write handles invalid arguments gracefully", async () => {
  try {
    // @ts-expect-error - testing invalid arguments
    await navigator.clipboard.write();
    expect.unreachable("Should have thrown an error");
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
  }
});

test("writeText handles non-string arguments", async () => {
  // Should convert to string
  // @ts-expect-error - testing type coercion
  await navigator.clipboard.writeText(123);
  const result = await navigator.clipboard.readText();
  expect(result).toBe("123");
});

test("multiple write/read operations work correctly", async () => {
  const texts = ["First text", "Second text", "Third text"];
  
  for (const text of texts) {
    await navigator.clipboard.writeText(text);
    const result = await navigator.clipboard.readText();
    expect(result).toBe(text);
  }
});

test("concurrent clipboard operations work", async () => {
  // Test that concurrent operations don't crash - results may vary due to race conditions
  const operations = Array.from({ length: 3 }, (_, i) => 
    navigator.clipboard.writeText(`Concurrent text ${i}`)
  );
  
  // Just ensure all operations complete without errors
  await Promise.all(operations);
  
  // The final result should be one of the concurrent texts
  const finalResult = await navigator.clipboard.readText();
  expect(finalResult.startsWith("Concurrent text")).toBe(true);
});

test("clipboard persists between operations", async () => {
  const testText = "Persistent clipboard text " + Date.now(); // Make unique to avoid interference
  
  await navigator.clipboard.writeText(testText);
  
  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 50));
  
  const result = await navigator.clipboard.readText();
  expect(result).toBe(testText);
});

test("read with unsupported type shows appropriate error", async () => {
  try {
    // @ts-expect-error - testing unsupported type
    await navigator.clipboard.read("application/unsupported-type");
    expect.unreachable("Should have thrown an error");
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("Unsupported clipboard type");
  }
});

// This test might be platform-specific and could be skipped on some systems
test("clipboard handles large text content", async () => {
  const largeText = "A".repeat(10000); // 10KB of text
  
  await navigator.clipboard.writeText(largeText);
  const result = await navigator.clipboard.readText();
  expect(result).toBe(largeText);
  expect(result.length).toBe(10000);
});