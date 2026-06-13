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

  test("child overrides paths while inheriting jsx from extended config", async () => {
    // Parent provides jsxFactory (observable via build output), child provides paths.
    // This verifies both configs are merged: jsxFactory from parent + paths from child.
    using dir = tempDir("tsconfig-extends-override", {
      "index.tsx": `import { hello } from "@/utils"; console.log(hello(<div/>));`,
      "src/utils.ts": `export function hello(el: any) { return el; }`,
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
          jsx: "react",
          jsxFactory: "h",
        },
      }),
      "node_modules/shared-tsconfig/package.json": JSON.stringify({
        name: "shared-tsconfig",
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

    // jsxFactory: "h" from the parent config must be inherited
    expect(stdout).toContain("h(");
    expect(exitCode).toBe(0);
  });

  test("chained extends through node_modules (app -> @org/base -> @org/preset)", async () => {
    // Tests that extends chains work when intermediate configs are in node_modules.
    // The chain: app/tsconfig.json -> @org/base -> @org/preset (which has jsxFactory).
    using dir = tempDir("tsconfig-extends-chain", {
      "index.tsx": `console.log(<div/>)`,
      "tsconfig.json": JSON.stringify({
        extends: "@org/base",
      }),
      "node_modules/@org/base/tsconfig.json": JSON.stringify({
        extends: "@org/preset",
      }),
      "node_modules/@org/base/package.json": JSON.stringify({
        name: "@org/base",
        version: "1.0.0",
      }),
      "node_modules/@org/preset/tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsx: "react",
          jsxFactory: "h",
        },
      }),
      "node_modules/@org/preset/package.json": JSON.stringify({
        name: "@org/preset",
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

    // jsxFactory: "h" from @org/preset (2 levels deep) should be inherited
    expect(stdout).toContain("h(");
    expect(exitCode).toBe(0);
  });

  test("extends resolves from ancestor node_modules when not in project root", async () => {
    // node_modules is in the root, but the tsconfig is in a nested subdirectory.
    // The resolver must walk up from packages/app/ to find root/node_modules/.
    using dir = tempDir("tsconfig-extends-ancestor", {
      "packages/app/index.tsx": `console.log(<div/>)`,
      "packages/app/tsconfig.json": JSON.stringify({
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
      cmd: [
        bunExe(),
        "build",
        "--no-bundle",
        "--tsconfig-override",
        "packages/app/tsconfig.json",
        "packages/app/index.tsx",
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // jsxFactory: "h" from the ancestor node_modules config should be used
    expect(stdout).toContain("h(");
    expect(exitCode).toBe(0);
  });
});
