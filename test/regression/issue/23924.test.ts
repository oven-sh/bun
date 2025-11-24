import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { copyFile, mkdir } from "fs/promises";
import { join } from "path";

describe("issue #23924 - Bun.$ with quoted executable paths containing spaces", () => {
  // The original issue:
  // await Bun.$`"C:/Program Files/gs/gs10.06.0/bin/gswin64c.exe" -dNOPAUSE ...`
  // Error: bun: command not found: "C:/Program Files/gs/gs10.06.0/bin/gswin64c.exe"
  // Note: quotes were INCLUDED in the error message, meaning they weren't stripped

  test.skipIf(!isWindows)("should run executable with quoted absolute path", async () => {
    // Use where.exe which is guaranteed to exist on Windows
    const result = await $`"C:/Windows/System32/where.exe" where`.nothrow();

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("where.exe");
  });

  test.skipIf(!isWindows)("should run executable with unquoted absolute path", async () => {
    const result = await $`C:/Windows/System32/where.exe where`.nothrow();

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("where.exe");
  });

  test.skipIf(!isWindows)("should run executable with raw quoted path (exact issue pattern)", async () => {
    // This is the exact pattern from the issue using raw template strings
    const result = await $`${{ raw: '"C:/Windows/System32/where.exe" where' }}`.nothrow();

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("where.exe");
  });

  test.skipIf(!isWindows)("should run executable with path containing spaces (Program Files style)", async () => {
    // Create a temp directory with spaces like "Program Files"
    using dir = tempDir("test Program Files", {});
    const subDir = join(String(dir), "gs", "bin");
    await mkdir(subDir, { recursive: true });

    // Copy bun executable to the path with spaces
    const bunDest = join(subDir, "bun-test.exe");
    await copyFile(bunExe(), bunDest);

    // Test the exact issue pattern - raw string with quoted path containing spaces
    const pathWithSpaces = bunDest.replaceAll("\\", "/");
    const result = await $`${{ raw: `"${pathWithSpaces}" -e "console.log('success')"` }}`
      .nothrow()
      .env(bunEnv);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString().trim()).toBe("success");
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(!isWindows)("should run script in directory with spaces via JS interpolation", async () => {
    // Create a temp directory with a space in it - simulating "Program Files"
    using dir = tempDir("test dir with spaces", {
      "script.ts": `console.log("hello from script");`,
    });

    // Using JS interpolation (this was reported as working in the issue)
    const scriptPath = `${dir}/script.ts`;
    const result = await $`${bunExe()} ${scriptPath}`.nothrow().env(bunEnv);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString().trim()).toBe("hello from script");
    expect(result.exitCode).toBe(0);
  });

  test("should handle quoted executable paths with spaces on all platforms", async () => {
    // Create a temp directory with a space in it
    using dir = tempDir("test dir with spaces", {
      "script.ts": `console.log("hello from script");`,
    });

    const scriptPath = `${dir}/script.ts`;

    // Test running bun with a quoted path that has spaces
    const result = await $`"${bunExe()}" "${scriptPath}"`.nothrow().env(bunEnv);

    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString().trim()).toBe("hello from script");
    expect(result.exitCode).toBe(0);
  });
});
