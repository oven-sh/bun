import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { cpSync, readFileSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "path";

// This test verifies that multiple native NAPI modules maintain isolated exports
// when compiled with `bun build --compile`. On Linux, this was broken due to memfd
// file descriptor reuse causing dlopen to return cached handles.
// See: https://github.com/oven-sh/bun/issues/26045

describe("issue#26045", () => {
  it.skipIf(!isLinux)("multiple native modules have isolated exports in compiled binary", () => {
    // Copy fixture to temp directory
    using dir = tempDir("issue-26045", {
      "package.json": readFileSync(join(import.meta.dir, "package.json")),
      "test.js": readFileSync(join(import.meta.dir, "test.js")),
    });
    cpSync(join(import.meta.dir, "module-a"), join(String(dir), "module-a"), { recursive: true });
    cpSync(join(import.meta.dir, "module-b"), join(String(dir), "module-b"), { recursive: true });

    // Install and build native modules
    const install = spawnSync({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (!install.success) {
      console.error("Install stderr:", install.stderr.toString());
    }
    expect(install.success).toBeTrue();

    // Compile the test script
    const exe = join(String(dir), "test-binary");
    const compile = spawnSync({
      cmd: [bunExe(), "build", "--compile", "test.js", "--outfile", exe],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (!compile.success) {
      console.error("Compile stderr:", compile.stderr.toString());
    }
    expect(compile.success).toBeTrue();

    // Run the compiled binary
    const run = spawnSync({
      cmd: [exe],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = run.stdout.toString().trim();
    const stderr = run.stderr.toString();

    if (!run.success) {
      console.error("Run stderr:", stderr);
      console.error("Run stdout:", stdout);
    }

    const result = JSON.parse(stdout);
    expect(result).toEqual({
      moduleA_keys: ["functionA"],
      moduleB_keys: ["functionB"],
      moduleA_functionA_type: "function",
      moduleB_functionB_type: "function",
    });
    expect(run.success).toBeTrue();
  });
});
