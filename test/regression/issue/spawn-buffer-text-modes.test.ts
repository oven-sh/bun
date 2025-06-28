import { describe, test, expect } from "bun:test";
import { spawn, spawnSync } from "bun";

// Regression test for stdout: "buffer" and stdout: "text" modes
describe("spawn buffer and text modes", () => {
  test("stdout: 'buffer' returns a promise that resolves to a Buffer", async () => {
    const proc = spawn({
      cmd: ["echo", "hello buffer"],
      stdout: "buffer",
    });

    expect(proc.stdout).toBeInstanceOf(Promise);
    const buffer = await proc.stdout;
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString()).toBe("hello buffer\n");
  });

  test("stdout: 'text' returns a promise that resolves to a string", async () => {
    const proc = spawn({
      cmd: ["echo", "hello text"],
      stdout: "text",
    });

    expect(proc.stdout).toBeInstanceOf(Promise);
    const text = await proc.stdout;
    expect(typeof text).toBe("string");
    expect(text).toBe("hello text\n");
  });

  test("spawnSync with stdout: 'buffer' returns Buffer in result", () => {
    const result = spawnSync({
      cmd: ["echo", "sync buffer"],
      stdout: "buffer",
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toBeInstanceOf(Buffer);
    expect(result.stdout?.toString()).toBe("sync buffer\n");
  });

  test("spawnSync with stdout: 'text' returns string in result", () => {
    const result = spawnSync({
      cmd: ["echo", "sync text"],
      stdout: "text",
    });

    expect(result.success).toBe(true);
    expect(typeof result.stdout).toBe("string");
    expect(result.stdout).toBe("sync text\n");
  });
});