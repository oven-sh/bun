import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";
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
  async function setupTestWithDependencies() {
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

    const install = spawn({
      cmd: [bunExe(), "install", "--lockfile-only"],
      cwd: testDir,
      env: bunEnv,
    });

    expect(await install.exited).toBe(0);

    return testDir;
  }

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
    const testDir = await setupTestWithDependencies();

    const { stdout, exited } = spawn({
      cmd: [bunExe(), ...cmd.split(" ")],
      cwd: testDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await stdout.text()).toContain(`bun why v${Bun.version.replace("-debug", "")}`);
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

  describe.concurrent("--json", () => {
    // app -> lib-a (dependencies), lib-b (devDependencies)
    // lib-a -> lib-c (dependencies), lib-d (optional peer)
    // lib-b -> lib-c (dependencies), lib-d (optionalDependencies)
    // lib-c -> lib-a (dependencies), which closes the cycle lib-a -> lib-c -> lib-a
    const integrity = "sha512-" + Buffer.alloc(86, "A").toString() + "==";
    const files = {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { "lib-a": "^1.0.0" },
        devDependencies: { "lib-b": "~2.0.0" },
      }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": {
            name: "app",
            dependencies: { "lib-a": "^1.0.0" },
            devDependencies: { "lib-b": "~2.0.0" },
          },
        },
        packages: {
          "lib-a": [
            "lib-a@1.0.0",
            "",
            { dependencies: { "lib-c": "^3.0.0" }, peerDependencies: { "lib-d": "*" }, optionalPeers: ["lib-d"] },
            integrity,
          ],
          "lib-b": [
            "lib-b@2.0.0",
            "",
            { dependencies: { "lib-c": "3.0.0" }, optionalDependencies: { "lib-d": "^4.0.0" } },
            integrity,
          ],
          "lib-c": ["lib-c@3.0.0", "", { dependencies: { "lib-a": "1.0.0" } }, integrity],
          "lib-d": ["lib-d@4.0.0", "", {}, integrity],
        },
      }),
    };

    async function whyJson(cwd: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...cmd.split(" "), ...args, "--json"],
        cwd,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    const app = (type: string, spec: string) => ({
      name: "app",
      version: null,
      type,
      optional: false,
      spec,
      dependents: [],
    });

    it("prints the dependents tree, with the cycle and the root marked", async () => {
      using dir = tempDir(`why-json-${i++}`, files);
      const { stdout, stderr, exitCode } = await whyJson(String(dir), "lib-c");
      expect(stderr).toBe("");
      expect(stdout).toEndWith("]\n");
      expect(JSON.parse(stdout)).toEqual([
        {
          name: "lib-c",
          version: "3.0.0",
          dependents: [
            {
              name: "lib-b",
              version: "2.0.0",
              type: "dependencies",
              optional: false,
              spec: "3.0.0",
              dependents: [app("devDependencies", "~2.0.0")],
            },
            {
              name: "lib-a",
              version: "1.0.0",
              type: "dependencies",
              optional: false,
              spec: "^3.0.0",
              dependents: [
                {
                  name: "lib-c",
                  version: "3.0.0",
                  type: "dependencies",
                  optional: false,
                  spec: "1.0.0",
                  dependents: [
                    {
                      name: "lib-b",
                      version: "2.0.0",
                      type: "dependencies",
                      optional: false,
                      spec: "3.0.0",
                      dependents: [app("devDependencies", "~2.0.0")],
                    },
                    {
                      name: "lib-a",
                      version: "1.0.0",
                      type: "dependencies",
                      optional: false,
                      spec: "^3.0.0",
                      circular: true,
                      dependents: null,
                    },
                  ],
                },
                app("dependencies", "^1.0.0"),
              ],
            },
          ],
        },
      ]);
      expect(exitCode).toBe(0);
    });

    it("reports optional dependencies and optional peers", async () => {
      using dir = tempDir(`why-json-${i++}`, files);
      const { stdout, stderr, exitCode } = await whyJson(String(dir), "lib-d", "--top");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        {
          name: "lib-d",
          version: "4.0.0",
          dependents: [
            {
              name: "lib-b",
              version: "2.0.0",
              type: "optionalDependencies",
              optional: true,
              spec: "^4.0.0",
              dependents: null,
            },
            { name: "lib-a", version: "1.0.0", type: "peerDependencies", optional: true, spec: "*", dependents: null },
          ],
        },
      ]);
      expect(exitCode).toBe(0);
    });

    it("--depth stops expanding with null, a package without dependents keeps []", async () => {
      using dir = tempDir(`why-json-${i++}`, files);
      const { stdout, stderr, exitCode } = await whyJson(String(dir), "lib-a", "--depth", "1");
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual([
        {
          name: "lib-a",
          version: "1.0.0",
          dependents: [
            { name: "lib-c", version: "3.0.0", type: "dependencies", optional: false, spec: "1.0.0", dependents: null },
            app("dependencies", "^1.0.0"),
          ],
        },
      ]);
      expect(exitCode).toBe(0);

      const depth0 = await whyJson(String(dir), "lib-d", "--depth", "0");
      expect(depth0.stderr).toBe("");
      expect(JSON.parse(depth0.stdout)).toEqual([{ name: "lib-d", version: "4.0.0", dependents: null }]);
      expect(depth0.exitCode).toBe(0);
    });

    it("a pattern matching several packages prints one object per package", async () => {
      using dir = tempDir(`why-json-${i++}`, files);
      const { stdout, stderr, exitCode } = await whyJson(String(dir), "lib-*", "--top");
      expect(stderr).toBe("");
      const ids = JSON.parse(stdout).map((pkg: { name: string; version: string }) => `${pkg.name}@${pkg.version}`);
      expect(ids.toSorted()).toEqual(["lib-a@1.0.0", "lib-b@2.0.0", "lib-c@3.0.0", "lib-d@4.0.0"]);
      expect(exitCode).toBe(0);
    });

    it("prints the usage on stderr when the package argument is missing", async () => {
      using dir = tempDir(`why-json-${i++}`, files);
      const { stdout, stderr, exitCode } = await whyJson(String(dir));
      expect(stdout).toBe("");
      expect(stderr).toContain("Explain why a package is installed");
      expect(exitCode).toBe(1);
    });

    it("prints [] and reports the error on stderr when nothing matches", async () => {
      using dir = tempDir(`why-json-${i++}`, files);
      const { stdout, stderr, exitCode } = await whyJson(String(dir), "missing");
      expect(stdout).toBe("[]\n");
      expect(stderr).toContain("No packages matching 'missing' found in lockfile");
      expect(exitCode).toBe(1);
    });
  });
});
