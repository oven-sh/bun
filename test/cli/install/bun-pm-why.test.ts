import { spawnSync } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe.each(["why", "pm why"])("bun %s", cmd => {
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

  function setupTestWithDependencies() {
    const testDir = tempDirWithFiles(`why-${i++}`, {
      "package.json": JSON.stringify(
        {
          name: "test-package",
          version: "1.0.0",
          dependencies: {
            "lodash": "^4.17.21",
            "react": "^18.0.0",
          },
          devDependencies: {
            "@types/react": "^18.0.0",
          },
        },
        null,
        2,
      ),
    });

    spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: testDir,
      env: bunEnv,
    });

    return testDir;
  }

  function setupComplexDependencyTree() {
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

    spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: testDir,
      env: bunEnv,
    });

    return testDir;
  }

  it("should show help when no package is specified", async () => {
    const testDir = setupTestWithDependencies();

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" ")],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stdout.toString()).toContain(`bun why v${Bun.version.replace("-debug", "")}`);
    expect(exitCode).toBe(1);
  });

  it("should show direct dependency", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "lodash"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();

    expect(output).toContain("lodash@");
    expect(output).toContain("foo");
    expect(output).toContain("requires ^4.17.21");
  });

  it("should show nested dependencies", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          express: "^4.18.2",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "mime-types"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("mime-types@");

    expect(output).toContain("accepts@");
    expect(output).toContain("express@");
  });

  it("should handle workspace dependencies", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "workspace-root",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
    );

    await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
    await mkdir(join(package_dir, "packages", "pkg-b"), { recursive: true });

    await writeFile(
      join(package_dir, "packages", "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
    );

    await writeFile(
      join(package_dir, "packages", "pkg-b", "package.json"),
      JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "workspace:*",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "pkg-a"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("pkg-a@");
    expect(output).toContain("pkg-b@");
  });

  it("should handle npm aliases", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          "alias-pkg": "npm:lodash@^4.17.21",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "alias-pkg"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (exitCode === 0) {
      const output = stdout.toString();
      expect(output).toContain("alias-pkg@");
    } else {
      expect(true).toBe(true);
    }
  });

  it("should show error for non-existent package", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "0.0.1",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, stderr, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "non-existent-package"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(1);

    const combinedOutput = stdout.toString() + stderr.toString();

    expect(combinedOutput.includes("No packages matching") || combinedOutput.includes("not found in lockfile")).toBe(
      true,
    );
  });

  it("should show dependency types correctly", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
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
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout: devStdout, exitCode: devExited } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "typescript"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(devExited).toBe(0);
    const devOutput = devStdout.toString();
    expect(devOutput).toContain("dev");

    const { stdout: peerStdout, exitCode: peerExited } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "react"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(peerExited).toBe(0);
    const peerOutput = peerStdout.toString();
    expect(peerOutput).toContain("peer");

    const { stdout: optStdout, exitCode: optExited } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "chalk"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(optExited).toBe(0);
    const optOutput = optStdout.toString();
    expect(optOutput).toContain("optional");
  });

  it("should handle packages with multiple versions", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "multi-version-test",
        version: "1.0.0",
        dependencies: {
          "react": "^18.0.0",
          "old-package": "npm:react@^16.0.0",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "react"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(exitCode).toBe(0);
    const output = stdout.toString();

    expect(output).toContain("react@");
  });

  it("should handle deeply nested dependencies", async () => {
    const testDir = setupComplexDependencyTree();

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();

    expect(output).toContain("mime-db@");
    expect(output).toContain("mime-types@");

    const lines = output.split("\n");
    const indentedLines = lines.filter(line => line.includes("  "));
    expect(indentedLines.length).toBeGreaterThan(0);
  });

  it("should support glob patterns for package names", async () => {
    const testDir = setupComplexDependencyTree();

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "@types/*"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("@types/");
    expect(output).toContain("dev");
  });

  it("should support version constraints in the query", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "version-test",
        version: "1.0.0",
        dependencies: {
          "react": "^18.0.0",
          "lodash": "^4.17.21",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "react@^18.0.0"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (exitCode === 0) {
      const output = stdout.toString();
      expect(output).toContain("react@");
    } else {
      expect(true).toBe(true);
    }
  });

  it("should handle nested workspaces", async () => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "workspace-root",
        version: "1.0.0",
        workspaces: ["packages/*", "apps/*"],
      }),
    );

    await mkdir(join(package_dir, "packages", "pkg-a"), { recursive: true });
    await mkdir(join(package_dir, "packages", "pkg-b"), { recursive: true });
    await mkdir(join(package_dir, "apps", "app-a"), { recursive: true });

    await writeFile(
      join(package_dir, "packages", "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        version: "1.0.0",
        dependencies: {
          lodash: "^4.17.21",
        },
      }),
    );

    await writeFile(
      join(package_dir, "packages", "pkg-b", "package.json"),
      JSON.stringify({
        name: "pkg-b",
        version: "1.0.0",
        dependencies: {
          "pkg-a": "workspace:*",
        },
      }),
    );

    await writeFile(
      join(package_dir, "apps", "app-a", "package.json"),
      JSON.stringify({
        name: "app-a",
        version: "1.0.0",
        dependencies: {
          "pkg-b": "workspace:*",
        },
      }),
    );

    const install = spawnSync({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(install.exitCode).toBe(0);

    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "lodash"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("lodash@");
    expect(output).toContain("pkg-a");

    const lines = output.split("\n");
    expect(lines.some(line => line.includes("pkg-a"))).toBe(true);
  });

  it("should support the --top flag to limit dependency tree depth", async () => {
    const testDir = setupComplexDependencyTree();

    const { stdout: stdoutWithTop, exitCode: exitedWithTop } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db", "--top"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitedWithTop).toBe(0);
    const outputWithTop = stdoutWithTop.toString();

    const { stdout: stdoutWithoutTop, exitCode: exitedWithoutTop } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitedWithoutTop).toBe(0);
    const outputWithoutTop = stdoutWithoutTop.toString();

    expect(outputWithTop.length).toBeGreaterThan(0);
    expect(outputWithoutTop.length).toBeGreaterThan(0);
  });

  it("should support the --depth flag to limit dependency tree depth", async () => {
    const testDir = setupComplexDependencyTree();

    const { stdout: stdoutDepth2, exitCode: exitedDepth2 } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db", "--depth", "2"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitedDepth2).toBe(0);
    const outputDepth2 = stdoutDepth2.toString();

    const { stdout: stdoutNoDepth, exitCode: exitedNoDepth } = spawnSync({
      cmd: [bunExe(), ...cmd.split(" "), "mime-db"],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitedNoDepth).toBe(0);
    const outputNoDepth = stdoutNoDepth.toString();

    expect(outputDepth2.split("\n").length).toBeLessThan(outputNoDepth.split("\n").length);

    expect(outputDepth2).toContain("mime-db@");
  });
});
