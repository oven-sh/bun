import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("tsconfig extends from node_modules", () => {
  test("extends with explicit .json path from scoped package", async () => {
    using dir = tempDir("tsconfig-extends-pkg", {
      "index.tsx": `console.log(<div/>)`,
      "tsconfig.json": JSON.stringify({
        extends: "@my-configs/tsconfig/tsconfig.json",
      }),
      "node_modules/@my-configs/tsconfig/tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsx: "react",
          jsxFactory: "h",
        },
      }),
      "node_modules/@my-configs/tsconfig/package.json": JSON.stringify({
        name: "@my-configs/tsconfig",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "index.tsx"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // jsxFactory: "h" from the extended config should be used
    expect(stdout).toContain("h(");
    expect(exitCode).toBe(0);
  });

  test("extends with bare package name (implicit tsconfig.json)", async () => {
    using dir = tempDir("tsconfig-extends-bare", {
      "index.tsx": `console.log(<div/>)`,
      "tsconfig.json": JSON.stringify({
        extends: "@my-configs/base",
      }),
      "node_modules/@my-configs/base/tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsx: "react",
          jsxFactory: "h",
        },
      }),
      "node_modules/@my-configs/base/package.json": JSON.stringify({
        name: "@my-configs/base",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "index.tsx"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // jsxFactory: "h" from the extended config should be used
    expect(stdout).toContain("h(");
    expect(exitCode).toBe(0);
  });

  test("extends with unscoped package name", async () => {
    using dir = tempDir("tsconfig-extends-unscoped", {
      "index.tsx": `console.log(<div/>)`,
      "tsconfig.json": JSON.stringify({
        extends: "my-tsconfig",
      }),
      "node_modules/my-tsconfig/tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsx: "react",
          jsxFactory: "h",
        },
      }),
      "node_modules/my-tsconfig/package.json": JSON.stringify({
        name: "my-tsconfig",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "index.tsx"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // jsxFactory: "h" from the extended config should be used
    expect(stdout).toContain("h(");
    expect(exitCode).toBe(0);
  });

  test("child overrides paths from extended config in node_modules", async () => {
    // The extended config provides jsx settings, the child provides its own paths
    using dir = tempDir("tsconfig-extends-override", {
      "index.ts": `import { hello } from "@/utils"; console.log(hello());`,
      "src/utils.ts": `export function hello() { return "it works"; }`,
      "tsconfig.json": JSON.stringify({
        extends: "shared-tsconfig",
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["./src/*"],
          },
        },
      }),
      "node_modules/shared-tsconfig/tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
        },
      }),
      "node_modules/shared-tsconfig/package.json": JSON.stringify({
        name: "shared-tsconfig",
        version: "1.0.0",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "index.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("it works");
    expect(exitCode).toBe(0);
  });
});
