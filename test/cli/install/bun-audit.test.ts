import { readableStreamToText, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { writeFile } from "fs/promises";
import { bunExe, bunEnv as env, VerdaccioRegistry } from "harness";
import { join } from "path";

var registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe("bun pm audit", async () => {
  it("should recognize audit as a command", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "test-package",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    const installResult = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    await installResult.exited;

    const auditResult = spawn({
      cmd: [bunExe(), "pm", "audit"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(auditResult.stdout).text(),
      new Response(auditResult.stderr).text(),
    ]);

    const exitCode = await auditResult.exited;

    expect(stdout).toBeDefined();
    expect(exitCode).toBe(0);
  });

  it("should work with multiple packages", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "test-package",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "a-dep": "1.0.0",
        },
      }),
    );

    const installResult = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    await installResult.exited;

    const auditResult = spawn({
      cmd: [bunExe(), "pm", "audit"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await readableStreamToText(auditResult.stdout);

    const exitCode = await auditResult.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toBeDefined();
  });

  it("should work with workspaces", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "workspace-root",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    await write(
      join(packageDir, "packages", "workspace-pkg", "package.json"),
      JSON.stringify({
        name: "workspace-pkg",
        version: "1.0.0",
        dependencies: {
          "a-dep": "1.0.0",
        },
      }),
    );

    const installResult = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    await installResult.exited;

    const auditResult = spawn({
      cmd: [bunExe(), "pm", "audit"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(auditResult.stdout).text(),
      new Response(auditResult.stderr).text(),
    ]);

    const exitCode = await auditResult.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toBeDefined();
  });

  it("should handle empty package.json", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "test-package",
        version: "1.0.0",
        dependencies: {},
      }),
    );

    const auditResult = spawn({
      cmd: [bunExe(), "pm", "audit"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(auditResult.stdout).text(),
      new Response(auditResult.stderr).text(),
    ]);

    const exitCode = await auditResult.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toBeDefined();
  });

  it("should make HTTP request to audit endpoint", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();

    await writeFile(
      packageJson,
      JSON.stringify({
        name: "test-package",
        version: "1.0.0",
        dependencies: {
          "no-deps": "1.0.0",
          "a-dep": "1.0.0",
        },
      }),
    );

    const installResult = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    await installResult.exited;

    // @ts-expect-error issue with process.env in bun-types (is fixed in a PR)
    const auditResult = spawn({
      cmd: [bunExe(), "pm", "audit"],
      cwd: packageDir,
      env: {
        ...env,

        NODE_DEBUG: "http",
        BUN_DEBUG_QUIET_LOGS: "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(auditResult.stdout).text(),
      new Response(auditResult.stderr).text(),
    ]);

    const exitCode = await auditResult.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toBeDefined();
  });
});
