import { describe, test, expect } from "bun:test";
import { bunExe } from "harness";

describe("ReadableStream conversion methods", () => {
  test("Bun.spawn() process.stdout.text() should capture process output", async () => {
    // Spawn a process that outputs some text
    const process = Bun.spawn([bunExe(), "-e", "console.log('Hello from Bun spawn! 🚀')"]);

    // Convert the process stdout to text using .text()
    const result = await process.stdout.text();
    await process.exited;

    expect(result).toBe("Hello from Bun spawn! 🚀\n");
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.text() should convert stream to text", async () => {
    // Spawn a process that outputs text
    const text = "Hello, this is a test stream! 🌊 测试";
    const process = Bun.spawn([bunExe(), "-e", `console.log("${text}")`]);

    // Convert the process stdout to text using .text()
    const result = await process.stdout.text();
    await process.exited;

    expect(result.trim()).toBe(text);
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.json() should convert stream to JSON", async () => {
    // Spawn a process that outputs JSON data
    const jsonData = { message: "Hello from JSON stream! 🎯", count: 42, active: true, emoji: "🌟" };
    const process = Bun.spawn([bunExe(), "-e", `console.log('${JSON.stringify(jsonData)}')`]);

    // Convert the process stdout to JSON using .json()
    const result = await process.stdout.json();
    await process.exited;

    expect(result).toEqual(jsonData);
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.arrayBuffer() should convert stream to ArrayBuffer", async () => {
    // Generate random binary data
    const randomBytes = new Uint8Array(256);
    crypto.getRandomValues(randomBytes);
    const binaryData = Buffer.from(randomBytes);

    const process = Bun.spawn([bunExe(), "-e", `process.stdout.write(Buffer.from([${Array.from(binaryData)}]))`]);

    // Convert the process stdout to ArrayBuffer using .arrayBuffer()
    const result = await process.stdout.arrayBuffer();
    await process.exited;

    // Compare the ArrayBuffer directly with the original binary data
    expect(result).toEqual(new Uint8Array(binaryData).buffer);
    expect(process.exitCode).toBe(0);
  });

  test("Bun.spawn() process.stdout.bytes() should convert stream to Uint8Array", async () => {
    // Generate random binary data
    const randomBytes = new Uint8Array(128);
    crypto.getRandomValues(randomBytes);
    const binaryData = Buffer.from(randomBytes);

    const process = Bun.spawn([bunExe(), "-e", `process.stdout.write(Buffer.from([${Array.from(binaryData)}]))`]);

    // Convert the process stdout to Uint8Array using .bytes()
    const result = await process.stdout.bytes();
    await process.exited;

    // Compare the Uint8Array directly with the original binary data
    expect(result).toEqual(new Uint8Array(binaryData));
    expect(process.exitCode).toBe(0);
    expect(result).toBeInstanceOf(Uint8Array);
  });
});
