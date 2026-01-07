import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bun-cjs pragma with shebang", () => {
  test("should execute CJS wrapper when source has shebang", async () => {
    using dir = tempDir("bun-cjs-shebang", {
      "test.js": `#!/usr/bin/env bun
// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {
console.log("Hello from CJS!");
module.exports = { value: 42 };
})`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("Hello from CJS!");
    expect(exitCode).toBe(0);
  });

  test("should execute CJS wrapper when source has shebang and bytecode pragma", async () => {
    using dir = tempDir("bun-cjs-bytecode-shebang", {
      "test.js": `#!/usr/bin/env bun
// @bun @bytecode @bun-cjs
(function(exports, require, module, __filename, __dirname) {
console.log("Hello from bytecode CJS!");
module.exports = { value: 42 };
})`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("Hello from bytecode CJS!");
    expect(exitCode).toBe(0);
  });

  test("should work with bundled bytecode output with source shebang", async () => {
    using dir = tempDir("bundled-bytecode-shebang", {
      "index.ts": `#!/usr/bin/env bun
console.log("Hello from bytecode!");`,
    });

    // Build with bytecode
    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "--outdir", "out", "--target", "bun", "--bytecode", "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const buildExitCode = await buildProc.exited;
    expect(buildExitCode).toBe(0);

    // Run the bundled output
    await using runProc = Bun.spawn({
      cmd: [bunExe(), "out/index.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      runProc.stdout.text(),
      runProc.stderr.text(),
      runProc.exited,
    ]);

    expect(stdout.trim()).toBe("Hello from bytecode!");
    expect(exitCode).toBe(0);
  });
});
