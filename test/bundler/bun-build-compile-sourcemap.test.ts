import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join } from "path";

describe("Bun.build compile with sourcemap", () => {
  const helperFiles = {
    "helper.js": `export function helperFunction() {
  throw new Error("Error from helper module");
}`,
    "app.js": `import { helperFunction } from "./helper.js";

function main() {
  helperFunction();
}

main();`,
  };

  async function testSourcemapOption(sourcemapValue: "inline" | "external" | true, testName: string) {
    using dir = tempDir(`build-compile-sourcemap-${testName}`, helperFiles);

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: true,
      sourcemap: sourcemapValue,
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const executablePath = result.outputs[0].path;
    expect(await Bun.file(executablePath).exists()).toBe(true);

    // Run the compiled executable and capture the error
    await using proc = Bun.spawn({
      cmd: [executablePath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // With sourcemaps working, we should see the actual file names
    expect(stderr).toContain("helper.js");
    expect(stderr).toContain("app.js");

    // Should NOT see the bundled virtual path (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows)
    expect(stderr).not.toMatch(/(\$bunfs|~BUN)\/root\//);

    // Verify it failed (the error was thrown)
    expect(exitCode).not.toBe(0);
  }

  test.each([
    ["inline" as const, "inline"],
    [true as const, "true"],
    ["external" as const, "external"],
  ])("compile with sourcemap: %s should work", async (sourcemapValue, testName) => {
    await testSourcemapOption(sourcemapValue, testName);
  });

  test("compile without sourcemap should show bundled paths", async () => {
    using dir = tempDir("build-compile-no-sourcemap", helperFiles);

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: true,
      // No sourcemap option
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const executablePath = result.outputs[0].path;
    expect(await Bun.file(executablePath).exists()).toBe(true);

    // Run the compiled executable and capture the error
    await using proc = Bun.spawn({
      cmd: [executablePath],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Without sourcemaps, we should see the bundled virtual path (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows)
    expect(stderr).toMatch(/(\$bunfs|~BUN)\/root\//);

    // Verify it failed (the error was thrown)
    expect(exitCode).not.toBe(0);
  });

  test("compile with multiple source files", async () => {
    using dir = tempDir("build-compile-sourcemap-multiple-files", {
      "utils.js": `export function utilError() {
  throw new Error("Error from utils");
}`,
      "helper.js": `import { utilError } from "./utils.js";
export function helperFunction() {
  utilError();
}`,
      "app.js": `import { helperFunction } from "./helper.js";

function main() {
  helperFunction();
}

main();`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: true,
      sourcemap: "inline",
    });

    expect(result.success).toBe(true);
    const executable = result.outputs[0].path;
    expect(await Bun.file(executable).exists()).toBe(true);

    // Run the executable
    await using proc = Bun.spawn({
      cmd: [executable],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // With sourcemaps, should show all three source file names
    expect(stderr).toContain("utils.js");
    expect(stderr).toContain("helper.js");
    expect(stderr).toContain("app.js");

    // Should NOT show bundled paths (/$bunfs/root/ on Unix, B:/~BUN/root/ on Windows)
    expect(stderr).not.toMatch(/(\$bunfs|~BUN)\/root\//);

    // Verify it failed (the error was thrown)
    expect(exitCode).not.toBe(0);
  });
});
