import { describe, expect, test } from "bun:test";

describe("spawn with spoofed array length", () => {
  test("Bun.spawnSync throws on array with length near u32 max", () => {
    const arr = ["echo", "hello"];
    Object.defineProperty(arr, "length", { value: 4294967295 });
    expect(() => {
      Bun.spawnSync(arr);
    }).toThrow(/cmd array is too large/);
  });

  test("Bun.spawn throws on array with length near u32 max", () => {
    const arr = ["echo", "hello"];
    Object.defineProperty(arr, "length", { value: 4294967295 });
    expect(() => {
      Bun.spawn(arr);
    }).toThrow(/cmd array is too large/);
  });

  test("Bun.spawnSync still works with normal arrays", () => {
    const result = Bun.spawnSync(["echo", "hello"]);
    expect(result.stdout.toString().trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });
});
