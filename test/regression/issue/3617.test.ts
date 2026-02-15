import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "node:path";

describe("issue #3617: tsconfig references path mappings", () => {
  test("should resolve paths from referenced tsconfig", async () => {
    // Create test structure matching the issue's reproduction case
    const dir = tempDirWithFiles("tsconfig-references", {
      // Main tsconfig with references pointing to app config
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }],
      }),
      // App tsconfig with path mappings
      "tsconfig.app.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "~/*": ["./src/*"],
          },
        },
        include: ["src/**/*"],
      }),
      // Source file
      "src/number.ts": `
        export function displayMax(a: number, b: number): number {
          return Math.max(a, b);
        }
      `,
      // Main file using the path alias
      "index.ts": `
        import { displayMax } from "~/number";
        console.log("Result:", displayMax(1, 2));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(dir, "index.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Cannot find module");
    expect(stdout).toContain("Result: 2");
    expect(exitCode).toBe(0);
  });

  test("should resolve paths from referenced tsconfig directory (without .json extension)", async () => {
    // Reference can point to a directory containing tsconfig.json
    const dir = tempDirWithFiles("tsconfig-references-dir", {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./packages/core" }],
      }),
      "packages/core/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "../..",
          paths: {
            "@core/*": ["./packages/core/src/*"],
          },
        },
      }),
      "packages/core/src/utils.ts": `
        export function greet(name: string): string {
          return \`Hello, \${name}!\`;
        }
      `,
      "app/index.ts": `
        import { greet } from "@core/utils";
        console.log(greet("World"));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(dir, "app/index.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Cannot find module");
    expect(stdout).toContain("Hello, World!");
    expect(exitCode).toBe(0);
  });

  test("should prefer main config paths over referenced config paths", async () => {
    // Main config paths should have higher priority than referenced config paths
    const dir = tempDirWithFiles("tsconfig-references-priority", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@lib/*": ["./lib-override/*"],
          },
        },
        references: [{ path: "./tsconfig.base.json" }],
      }),
      "tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@lib/*": ["./lib-base/*"],
          },
        },
      }),
      "lib-override/helper.ts": `
        export const value = "from-override";
      `,
      "lib-base/helper.ts": `
        export const value = "from-base";
      `,
      "index.ts": `
        import { value } from "@lib/helper";
        console.log(value);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(dir, "index.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Cannot find module");
    expect(stdout).toContain("from-override");
    expect(exitCode).toBe(0);
  });

  test("should merge non-conflicting paths from referenced config", async () => {
    // Referenced config should add additional paths that don't conflict with main
    const dir = tempDirWithFiles("tsconfig-references-merge", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@app/*": ["./app/*"],
          },
        },
        references: [{ path: "./tsconfig.lib.json" }],
      }),
      "tsconfig.lib.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@lib/*": ["./lib/*"],
          },
        },
      }),
      "app/main.ts": `
        export const appValue = "app";
      `,
      "lib/utils.ts": `
        export const libValue = "lib";
      `,
      "index.ts": `
        import { appValue } from "@app/main";
        import { libValue } from "@lib/utils";
        console.log(appValue, libValue);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(dir, "index.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Cannot find module");
    expect(stdout).toContain("app");
    expect(stdout).toContain("lib");
    expect(exitCode).toBe(0);
  });

  test("should handle multiple references", async () => {
    // Multiple references should all be processed
    const dir = tempDirWithFiles("tsconfig-references-multiple", {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./packages/a/tsconfig.json" }, { path: "./packages/b/tsconfig.json" }],
      }),
      "packages/a/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "../..",
          paths: {
            "@a/*": ["./packages/a/src/*"],
          },
        },
      }),
      "packages/b/tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: "../..",
          paths: {
            "@b/*": ["./packages/b/src/*"],
          },
        },
      }),
      "packages/a/src/a.ts": `
        export const a = "from-a";
      `,
      "packages/b/src/b.ts": `
        export const b = "from-b";
      `,
      "index.ts": `
        import { a } from "@a/a";
        import { b } from "@b/b";
        console.log(a, b);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(dir, "index.ts")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Cannot find module");
    expect(stdout).toContain("from-a");
    expect(stdout).toContain("from-b");
    expect(exitCode).toBe(0);
  });
});
