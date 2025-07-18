import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("binary linking with invalid paths", () => {
  it("should handle malformed packages without panic", async () => {
    // Create a test directory with a malformed package that could cause
    // the relative path to not start with ".." or "..\\"
    const dir = tempDirWithFiles("malformed-bin-test", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "malformed-bin": "file:./malformed-bin",
        },
      }),
      "malformed-bin/package.json": JSON.stringify({
        name: "malformed-bin",
        version: "1.0.0",
        bin: {
          "malformed-bin": "../../evil-script.js", // Path traversal that could escape
        },
      }),
      "malformed-bin/evil-script.js": "#!/usr/bin/env node\nconsole.log('evil');\n",
      "evil-script.js": "#!/usr/bin/env node\nconsole.log('should not be accessible');\n",
    });

    // This should not panic but should handle the error gracefully
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // The installation should not panic (this is the main fix)
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Internal assertion failure");
    
    // Print output for debugging
    console.log("Exit code:", exitCode);
    console.log("STDOUT:", stdout);
    console.log("STDERR:", stderr);
    
    // The important thing is no panic occurred
    // The exit code behavior may vary based on how Bun handles the error
  });

  it("should handle packages with normal binary references (baseline)", async () => {
    // Normal case that should work fine
    const dir = tempDirWithFiles("normal-bin-test", {
      "package.json": JSON.stringify({
        name: "test-app",
        dependencies: {
          "normal-bin": "file:./normal-bin",
        },
      }),
      "normal-bin/package.json": JSON.stringify({
        name: "normal-bin",
        version: "1.0.0",
        bin: {
          "normal-bin": "./script.js",
        },
      }),
      "normal-bin/script.js": "#!/usr/bin/env node\nconsole.log('normal');\n",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should not panic and should succeed
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Internal assertion failure");
    expect(exitCode).toBe(0);
  });
});