import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";

describe("shell .quiet() should preserve exit codes", () => {
  test("builtin rm with .quiet() throws on failure", async () => {
    using dir = tempDir("issue-18161", {});
    try {
      await $`rm ${dir}/nonexistent-file.txt`.quiet();
      expect.unreachable();
    } catch (e: any) {
      expect(e.exitCode).not.toBe(0);
    }
  });

  test("builtin rm with .nothrow().quiet() returns non-zero exit code", async () => {
    using dir = tempDir("issue-18161", {});
    const result = await $`rm ${dir}/nonexistent-file.txt`.nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
  });

  test("builtin rm with .text() throws on failure", async () => {
    using dir = tempDir("issue-18161", {});
    try {
      await $`rm ${dir}/nonexistent-file.txt`.text();
      expect.unreachable();
    } catch (e: any) {
      expect(e.exitCode).not.toBe(0);
    }
  });

  test("builtin rm with .quiet() returns 0 on success", async () => {
    using dir = tempDir("issue-18161", {
      "existing-file.txt": "hello",
    });
    const result = await $`rm ${dir}/existing-file.txt`.nothrow().quiet();
    expect(result.exitCode).toBe(0);
  });

  test("builtin rm exit code matches between quiet and non-quiet", async () => {
    using dir = tempDir("issue-18161", {});
    const nonQuiet = await $`rm ${dir}/nonexistent-file.txt`.nothrow();
    const quiet = await $`rm ${dir}/nonexistent-file.txt`.nothrow().quiet();
    expect(quiet.exitCode).toBe(nonQuiet.exitCode);
  });
});
