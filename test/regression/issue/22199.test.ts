import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("plugin onResolve returning undefined should not crash", () => {
  using dir = tempDir("plugin-undefined", {
    "plugin.js": `
      Bun.plugin({
        name: "test-plugin",
        setup(build) {
          build.onResolve({ filter: /.*\\.(ts|tsx|js|jsx)$/ }, async (args) => {
            // Returning undefined should continue to next plugin or default resolution
            return undefined;
          });
        },
      });
    `,
    "index.js": `console.log("Hello from index.js");`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "--preload", "./plugin.js", "./index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("Hello from index.js");
});

test("plugin onResolve returning null should not crash", () => {
  using dir = tempDir("plugin-null", {
    "plugin.js": `
      Bun.plugin({
        name: "test-plugin",
        setup(build) {
          build.onResolve({ filter: /.*\\.(ts|tsx|js|jsx)$/ }, async (args) => {
            // Returning null should continue to next plugin or default resolution
            return null;
          });
        },
      });
    `,
    "index.js": `console.log("Hello from index.js");`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "--preload", "./plugin.js", "./index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("Hello from index.js");
});

test("plugin onResolve with sync function returning undefined should not crash", () => {
  using dir = tempDir("plugin-sync-undefined", {
    "plugin.js": `
      Bun.plugin({
        name: "test-plugin",
        setup(build) {
          build.onResolve({ filter: /.*\\.(ts|tsx|js|jsx)$/ }, (args) => {
            // Sync function returning undefined
            return undefined;
          });
        },
      });
    `,
    "index.js": `console.log("Hello from index.js");`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "--preload", "./plugin.js", "./index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("Hello from index.js");
});

test("plugin onResolve with rejected promise should throw error", () => {
  using dir = tempDir("plugin-reject", {
    "plugin.js": `
      Bun.plugin({
        name: "test-plugin",
        setup(build) {
          build.onResolve({ filter: /.*\\.(ts|tsx|js|jsx)$/ }, async (args) => {
            throw new Error("Custom plugin error");
          });
        },
      });
    `,
    "index.js": `console.log("Hello from index.js");`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "--preload", "./plugin.js", "./index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("Custom plugin error");
});
