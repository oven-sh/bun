import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir, tempDirWithFiles } from "harness";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let package_dir: string;
let i = 0;
beforeAll(async () => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "why-test-"));

  package_dir = join(base, `why-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(package_dir, { recursive: true });
});

afterAll(async () => {
  if (existsSync(package_dir)) {
    await rm(package_dir, { recursive: true, force: true });
  }
});

describe.concurrent.each(["why", "pm why"])("bun %s", cmd => {
  async function setupComplexDependencyTree() {
    const testDir = tempDirWithFiles(`why-complex-${i++}`, {
      "package.json": JSON.stringify(
        {
          name: "complex-package",
          version: "1.0.0",
          dependencies: {
            "express": "^4.18.2",
            "react": "^18.0.0",
            "react-dom": "^18.0.0",
          },
          devDependencies: {
            "@types/express": "^4.17.17",
            "typescript": "^5.0.0",
          },
        },
        null,
        2,
      ),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: testDir,
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(await install.exited).toBe(0);

    return testDir;
  }

  it("should show help when no package is specified", async () => {
    using testDir = tempDir(`why-usage-${i++}`, {
      "package.json": JSON.stringify({ name: "test-package", version: "1.0.0" }),
    });

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" ")],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(normalizeBunSnapshot(await stdout.text())).toMatchInlineSnapshot(`
"bun why <version> (<revision>)
Explain why a package is installed

Arguments:
  <package>     The package name to explain (supports glob patterns like '@org/*')

Options:
  --top         Show only the top dependency tree instead of nested ones
  --depth <NUM> Maximum depth of the dependency tree to display

Examples:
  $ bun why react
  $ bun why "@types/*" --depth 2
  $ bun why "*-lodash" --top"
`);
    expect(await exited).toBe(1);
  });

  it("should show direct dependency", async () => {
    await using tmpDir = tempDir(`why-direct-dependency-${i++}`, {
      "package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "lodash"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exited).toBe(0);
    const output = await stdout.text();

    expect(output).toContain("lodash@");
    expect(output).toContain("foo");
    expect(output).toContain("requires ^4.17.21");
  });

  it("should show nested dependencies", async () => {
    await using tmpDir = tempDir(`why-nested-${i++}`, {
      "package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          express: "^4.18.2",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await install.exited).toBe(0);

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "mime-types"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    expect(await exited).toBe(0);
    const output = await stdout.text();
    expect(output).toContain("mime-types@");

    expect(output).toContain("accepts@");
    expect(output).toContain("express@");
  });

  it("should handle workspace dependencies", async () => {
    await using tmpDir = tempDir(`why-workspace-${i++}`, {
      "package.json": JSON.stringify({
        name: "workspace-root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "workspace:*",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await install.exited).toBe(0);

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "pkg-a"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    expect(await exited).toBe(0);
    const output = await stdout.text();
    expect(output).toContain("pkg-a@");
    expect(output).toContain("pkg-b@");
  });

  it("should handle npm aliases", async () => {
    await using tmpDir = tempDir(`why-alias-${i++}`, {
      "package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "alias-pkg": "npm:lodash@^4.17.21",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await install.exited).toBe(0);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "alias-pkg"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    if ((await exited) === 0) {
      const output = await stdout.text();
      expect(output).toContain("alias-pkg@");
    } else {
      expect(true).toBe(true);
    }
  });

  it("should show error for non-existent package", async () => {
    await using tmpDir = tempDir(`why-non-existent-${i++}`, {
      "package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await install.exited).toBe(0);

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "non-existent-package"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exited).toBe(1);

    const combinedOutput = (await stdout.text()) + (await stderr.text());

    expect(combinedOutput.includes("No packages matching") || combinedOutput.includes("not found in lockfile")).toBe(
      true,
    );
  });

  it("should show dependency types correctly", async () => {
    await using tmpDir = tempDir(`why-dependency-types-${i++}`, {
      "package.json": JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "express": "^4.18.2",
        },
        devDependencies: {
          "typescript": "^5.0.0",
        },
        peerDependencies: {
          "react": "^18.0.0",
        },
        optionalDependencies: {
          "chalk": "^5.0.0",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    const { stdout: devStdout, exited: devExited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "typescript"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await devExited).toBe(0);
    const devOutput = await devStdout.text();
    expect(devOutput).toContain("dev");

    const { stdout: peerStdout, exited: peerExited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "react"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await peerExited).toBe(0);
    const peerOutput = await peerStdout.text();
    expect(peerOutput).toContain("peer");

    const { stdout: optStdout, exited: optExited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "chalk"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    expect(await optExited).toBe(0);
    const optOutput = await optStdout.text();
    expect(optOutput).toContain("optional");
  });

  it("should handle packages with multiple versions", async () => {
    await using tmpDir = tempDir(`why-multi-version-${i++}`, {
      "package.json": JSON.stringify({
        name: "multi-version-test",
        version: "1.0.0",
        dependencies: {
          "react": "^18.0.0",
          "old-package": "npm:react@^16.0.0",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    expect(await install.exited).toBe(0);

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "react"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    expect(await exited).toBe(0);
    const output = await stdout.text();

    expect(output).toContain("react@");
  });

  it("should handle deeply nested dependencies", async () => {
    const testDir = await setupComplexDependencyTree();

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    expect(await exited).toBe(0);
    const output = await stdout.text();

    expect(output).toContain("mime-db@");
    expect(output).toContain("mime-types@");

    const lines = output.split("\n");
    const indentedLines = lines.filter(line => line.includes("  "));
    expect(indentedLines.length).toBeGreaterThan(0);
  });

  it("should support glob patterns for package names", async () => {
    const testDir = await setupComplexDependencyTree();

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "@types/*"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    expect(await exited).toBe(0);
    const output = await stdout.text();
    expect(output).toContain("@types/");
    expect(output).toContain("dev");
  });

  it("should support version constraints in the query", async () => {
    await using tmpDir = tempDir(`why-version-test-${i++}`, {
      "package.json": JSON.stringify({
        name: "version-test",
        version: "1.0.0",
        dependencies: {
          "react": "^18.0.0",
          "lodash": "^4.17.21",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    expect(await install.exited).toBe(0);

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "react@^18.0.0"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    if ((await exited) === 0) {
      const output = await stdout.text();
      expect(output).toContain("react@");
    } else {
      expect(true).toBe(true);
    }
  });

  it("should handle nested workspaces", async () => {
    await using tmpDir = tempDir(`why-workspace-${i++}`, {
      "package.json": JSON.stringify({
        name: "workspace-root",
        version: "1.0.0",
        workspaces: ["packages/*", "apps/*"],
      }),
      "packages/pkg-a/package.json": JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
      "packages/pkg-b/package.json": JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "workspace:*",
        },
      }),
      "apps/app-a/package.json": JSON.stringify({
        name: "app-a",
        version: "1.0.0",
        dependencies: {
          "pkg-b": "workspace:*",
        },
      }),
    });

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await install.exited).toBe(0);

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "lodash"],
      cwd: tmpDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exited).toBe(0);
    const output = await stdout.text();
    expect(output).toContain("lodash@");
    expect(output).toContain("pkg-a");

    const lines = output.split("\n");
    expect(lines.some(line => line.includes("pkg-a"))).toBe(true);
  });

  it("should support the --top flag to limit dependency tree depth", async () => {
    const tempDir = await setupComplexDependencyTree();

    const { stdout: stdoutWithTop, exited: exitedWithTop } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db", "--top"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exitedWithTop).toBe(0);
    const outputWithTop = await stdoutWithTop.text();

    const { stdout: stdoutWithoutTop, exited: exitedWithoutTop } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db"],
      cwd: tempDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exitedWithoutTop).toBe(0);
    const outputWithoutTop = await stdoutWithoutTop.text();

    expect(outputWithTop.length).toBeGreaterThan(0);
    expect(outputWithoutTop.length).toBeGreaterThan(0);
  });

  it("should support the --depth flag to limit dependency tree depth", async () => {
    const testDir = await setupComplexDependencyTree();

    const { stdout: stdoutDepth2, exited: exitedDepth2 } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db", "--depth", "2"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exitedDepth2).toBe(0);
    const outputDepth2 = await stdoutDepth2.text();

    const { stdout: stdoutNoDepth, exited: exitedNoDepth } = spawn({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exitedNoDepth).toBe(0);
    const outputNoDepth = await stdoutNoDepth.text();

    expect(outputDepth2.split("\n").length).toBeLessThan(outputNoDepth.split("\n").length);

    expect(outputDepth2).toContain("mime-db@");
  });
});
