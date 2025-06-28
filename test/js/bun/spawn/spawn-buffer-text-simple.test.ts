import { test, expect, describe } from "bun:test";
import { spawn, spawnSync } from "bun";

describe("Bun.spawn() buffer and text modes - simple", () => {
  test("async buffer mode works", async () => {
    const proc = spawn({
      cmd: ["echo", "hello buffer"],
      stdout: "buffer",
    });

    expect(proc.stdout).toBeInstanceOf(Promise);
    const buffer = await proc.stdout;
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.toString()).toBe("hello buffer\n");
  });

  test("async text mode works", async () => {
    const proc = spawn({
      cmd: ["echo", "hello text"],
      stdout: "text",
    });

    expect(proc.stdout).toBeInstanceOf(Promise);
    const text = await proc.stdout;
    expect(typeof text).toBe("string");
    expect(text).toBe("hello text\n");
  });

  test("sync buffer mode works", () => {
    const result = spawnSync({
      cmd: ["echo", "hello buffer"],
      stdout: "buffer",
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toBeDefined();
    expect(result.stdout).toBeInstanceOf(Buffer);
    if (result.stdout instanceof Buffer) {
      expect(result.stdout.toString()).toBe("hello buffer\n");
    }
  });

  test("sync text mode works", () => {
    const result = spawnSync({
      cmd: ["echo", "hello text"],
      stdout: "text",
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toBeDefined();
    expect(typeof result.stdout).toBe("string");
    expect(result.stdout).toBe("hello text\n");
  });

  test("stderr buffer mode works", async () => {
    const proc = spawn({
      cmd: ["sh", "-c", "echo error >&2"],
      stderr: "buffer",
    });

    const stderr = await proc.stderr;
    expect(stderr).toBeInstanceOf(Buffer);
    expect(stderr.toString()).toBe("error\n");
  });

  test("both stdout and stderr work together", async () => {
    const proc = spawn({
      cmd: ["sh", "-c", "echo out && echo err >&2"],
      stdout: "buffer",
      stderr: "text",
    });

    const [stdout, stderr] = await Promise.all([proc.stdout, proc.stderr]);
    expect(stdout).toBeInstanceOf(Buffer);
    expect(stdout.toString()).toBe("out\n");
    expect(typeof stderr).toBe("string");
    expect(stderr).toBe("err\n");
  });
});