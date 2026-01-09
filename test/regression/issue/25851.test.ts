import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

describe("Blob constructor with File parts", () => {
  test("new Blob([file]) preserves file size", async () => {
    using dir = tempDir("issue-25851", {
      "test.txt": "Hello, World!", // 13 bytes
    });

    const file = Bun.file(`${dir}/test.txt`);

    const blob = new Blob([file]);
    expect(blob.size).toBe(13);
    expect(await blob.text()).toBe("Hello, World!");
  });

  test("new Blob([file, buffer]) combines file and buffer sizes", async () => {
    using dir = tempDir("issue-25851", {
      "test.txt": "Hello", // 5 bytes
    });

    const file = Bun.file(`${dir}/test.txt`);
    const buffer = new ArrayBuffer(1000);

    const blob = new Blob([file, buffer]);
    expect(blob.size).toBe(1005); // 5 + 1000

    const text = await blob.text();
    expect(text.startsWith("Hello")).toBe(true);
    expect(text.length).toBe(1005);
  });

  test("new Blob([buffer, file]) combines buffer and file sizes", async () => {
    using dir = tempDir("issue-25851", {
      "test.txt": "World", // 5 bytes
    });

    const file = Bun.file(`${dir}/test.txt`);
    const buffer = new ArrayBuffer(1000);

    const blob = new Blob([buffer, file]);
    expect(blob.size).toBe(1005); // 1000 + 5

    const text = await blob.text();
    expect(text.endsWith("World")).toBe(true);
  });

  test("new Blob([file, file]) combines two file sizes", async () => {
    using dir = tempDir("issue-25851", {
      "test.txt": "Hello", // 5 bytes
    });

    const file = Bun.file(`${dir}/test.txt`);

    const blob = new Blob([file, file]);
    expect(blob.size).toBe(10); // 5 * 2
    expect(await blob.text()).toBe("HelloHello");
  });

  test("new Blob([file, string, buffer]) combines all parts", async () => {
    using dir = tempDir("issue-25851", {
      "test.txt": "Start", // 5 bytes
    });

    const file = Bun.file(`${dir}/test.txt`);
    const str = "Middle"; // 6 bytes
    const buffer = new Uint8Array([69, 110, 100]); // "End" - 3 bytes

    const blob = new Blob([file, str, buffer]);
    expect(blob.size).toBe(14); // 5 + 6 + 3
    expect(await blob.text()).toBe("StartMiddleEnd");
  });

  test("new Blob with nested arrays containing files", async () => {
    using dir = tempDir("issue-25851", {
      "test.txt": "Nested", // 6 bytes
    });

    const file = Bun.file(`${dir}/test.txt`);
    const buffer = new ArrayBuffer(5);

    // Nested arrays should be flattened
    const blob = new Blob([[file], [buffer]]);
    expect(blob.size).toBe(11); // 6 + 5
  });
});
