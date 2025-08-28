import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Regression test for issue #22199: segmentation fault when build.onResolve returns undefined
describe("issue #22199", () => {
  test("onResolve returning undefined should not crash - sync", async () => {
    const tempDir = tempDirWithFiles("plugin-test", {
      "plugin.ts": /* ts */ `
        Bun.plugin({
          name: "test-plugin",
          setup(build) {
            build.onResolve({ filter: /.*\.(ts|tsx|js|jsx)$/ }, (args) => {
              return undefined; // This should not crash
            });
          },
        });
      `,
      "index.ts": /* ts */ `
        console.log("Hello, World");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "plugin.ts", "index.ts"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should not crash with segmentation fault
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("Hello, World");
    expect(stderr).toBe("");
  });

  test("onResolve returning undefined should not crash - async", async () => {
    const tempDir = tempDirWithFiles("plugin-test-async", {
      "plugin.ts": /* ts */ `
        Bun.plugin({
          name: "test-plugin",
          setup(build) {
            build.onResolve({ filter: /.*\.(ts|tsx|js|jsx)$/ }, async (args) => {
              return undefined; // This should not crash
            });
          },
        });
      `,
      "index.ts": /* ts */ `
        console.log("Hello, World");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "plugin.ts", "index.ts"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should not crash with segmentation fault
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("Hello, World");
    expect(stderr).toBe("");
  });

  test("onResolve returning Promise.resolve(undefined) should not crash", async () => {
    const tempDir = tempDirWithFiles("plugin-test-promise", {
      "plugin.ts": /* ts */ `
        Bun.plugin({
          name: "test-plugin",
          setup(build) {
            build.onResolve({ filter: /.*\.(ts|tsx|js|jsx)$/ }, (args) => {
              return Promise.resolve(undefined); // This should not crash
            });
          },
        });
      `,
      "index.ts": /* ts */ `
        console.log("Hello, World");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "plugin.ts", "index.ts"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should not crash with segmentation fault
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("Hello, World");
    expect(stderr).toBe("");
  });

  test("onResolve returning null should not crash - async", async () => {
    const tempDir = tempDirWithFiles("plugin-test-null", {
      "plugin.ts": /* ts */ `
        Bun.plugin({
          name: "test-plugin",
          setup(build) {
            build.onResolve({ filter: /.*\.(ts|tsx|js|jsx)$/ }, async (args) => {
              return null; // This should not crash
            });
          },
        });
      `,
      "index.ts": /* ts */ `
        console.log("Hello, World");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "plugin.ts", "index.ts"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should not crash with segmentation fault
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("Hello, World");
    expect(stderr).toBe("");
  });
});