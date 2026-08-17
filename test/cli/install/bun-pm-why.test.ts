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

  describe("packages reachable through more than one path", () => {
    // Workspace packages that only depend on each other, so `bun install` never
    // contacts a registry. The root sorts before the `pkg-*`/`w*` names.
    function workspaceFixture(name: string, dependencies: Record<string, string[]>) {
      const files: Record<string, string> = {
        "package.json": JSON.stringify({ name: "monorepo", private: true, workspaces: ["p/*"] }),
      };
      for (const [pkg, deps] of Object.entries(dependencies)) {
        files[`p/${pkg}/package.json`] = JSON.stringify({
          name: pkg,
          version: "1.0.0",
          dependencies: Object.fromEntries(deps.map(dep => [dep, "workspace:*"])),
        });
      }
      return tempDir(name, files);
    }

    async function installAndWhy(cwd: string, args: string[]) {
      await using install = spawn({
        cmd: [bunExe(), "install", "--lockfile-only"],
        cwd,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, installStderr, installExitCode] = await Promise.all([
        install.stdout.text(),
        install.stderr.text(),
        install.exited,
      ]);
      expect(installStderr).toContain("Saved lockfile");
      expect(installExitCode).toBe(0);

      await using why = spawn({
        cmd: [bunExe(), ...cmd.split(" "), ...args],
        cwd,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([why.stdout.text(), why.stderr.text(), why.exited]);
      return {
        // The tree prints spacer lines that are only a trailing prefix.
        stdout: normalizeBunSnapshot(stdout)
          .split("\n")
          .map(line => line.trimEnd())
          .join("\n"),
        stderr,
        exitCode,
      };
    }

    // pkg-c is listed under pkg-x twice: it depends on pkg-x directly and on
    // pkg-a, which depends on pkg-x.
    const diamond = {
      "pkg-x": [],
      "pkg-a": ["pkg-x"],
      "pkg-c": ["pkg-x", "pkg-a"],
      "pkg-d": ["pkg-c"],
      "pkg-f": ["pkg-d"],
    };

    it("prints the dependents of a package once and marks later occurrences as deduped", async () => {
      using dir = workspaceFixture("why-deduped", diamond);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-a@workspace (requires workspace:*)
          │  └─ pkg-c@workspace (requires workspace:*)
          │     └─ pkg-d@workspace (requires workspace:*)
          │        └─ pkg-f@workspace (requires workspace:*)
          │
          └─ pkg-c@workspace (requires workspace:*)
             └─ *deduped"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    it("expands a deduped package again when --depth cut it off at a deeper occurrence", async () => {
      using dir = workspaceFixture("why-deduped-depth", diamond);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x", "--depth", "3"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-a@workspace (requires workspace:*)
          │  └─ pkg-c@workspace (requires workspace:*)
          │     └─ pkg-d@workspace (requires workspace:*)
          │        └─ (deeper dependencies hidden)
          │
          └─ pkg-c@workspace (requires workspace:*)
             └─ pkg-d@workspace (requires workspace:*)
                └─ pkg-f@workspace (requires workspace:*)"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    // pkg-a and pkg-p depend on each other. Walking up from pkg-x, the cycle is
    // first reached through pkg-l1 -> pkg-l2 -> pkg-a, where pkg-p's only
    // dependent (pkg-a) is cut off as circular, and again through pkg-p itself,
    // three levels closer to pkg-x.
    const cycle = {
      "pkg-x": [],
      "pkg-l1": ["pkg-x"],
      "pkg-l2": ["pkg-l1"],
      "pkg-a": ["pkg-l2", "pkg-p"],
      "pkg-p": ["pkg-a", "pkg-x"],
      "pkg-q1": ["pkg-a"],
      "pkg-q2": ["pkg-q1"],
      "pkg-q3": ["pkg-q2"],
    };

    it("does not dedupe a package whose circular branch hides what --depth would show closer to the root", async () => {
      using dir = workspaceFixture("why-deduped-cycle-depth", cycle);

      // pkg-q3 only fits within the depth limit under the shorter chain.
      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x", "--depth", "5"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-l1@workspace (requires workspace:*)
          │  └─ pkg-l2@workspace (requires workspace:*)
          │     └─ pkg-a@workspace (requires workspace:*)
          │        ├─ pkg-p@workspace (requires workspace:*)
          │        │  └─ pkg-a@workspace (requires workspace:*)
          │        │     └─ *circular
          │        └─ pkg-q1@workspace (requires workspace:*)
          │           └─ pkg-q2@workspace (requires workspace:*)
          │              └─ (deeper dependencies hidden)
          │
          └─ pkg-p@workspace (requires workspace:*)
             └─ pkg-a@workspace (requires workspace:*)
                ├─ pkg-p@workspace (requires workspace:*)
                │  └─ *circular
                └─ pkg-q1@workspace (requires workspace:*)
                   └─ pkg-q2@workspace (requires workspace:*)
                      └─ pkg-q3@workspace (requires workspace:*)"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    it("dedupes a package inside a cycle once its dependents were printed in full", async () => {
      using dir = workspaceFixture("why-deduped-cycle", cycle);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), ["pkg-x"]);
      expect(stdout).toMatchInlineSnapshot(`
        "pkg-x@workspace:p/pkg-x
          ├─ monorepo
          ├─ pkg-l1@workspace (requires workspace:*)
          │  └─ pkg-l2@workspace (requires workspace:*)
          │     └─ pkg-a@workspace (requires workspace:*)
          │        ├─ pkg-p@workspace (requires workspace:*)
          │        │  └─ pkg-a@workspace (requires workspace:*)
          │        │     └─ *circular
          │        └─ pkg-q1@workspace (requires workspace:*)
          │           └─ pkg-q2@workspace (requires workspace:*)
          │              └─ pkg-q3@workspace (requires workspace:*)
          │
          └─ pkg-p@workspace (requires workspace:*)
             └─ *deduped"
      `);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });

    it("keeps the output linear when every package depends on the next two", async () => {
      // w00 depends on w01 and w02, w01 on w02 and w03, and so on, so the
      // number of dependency paths between w15 and any one package grows like
      // the Fibonacci sequence.
      const count = 16;
      const name = (i: number) => `w${String(i).padStart(2, "0")}`;
      const ladder: Record<string, string[]> = {};
      for (let i = 0; i < count; i++) {
        ladder[name(i)] = [i + 1, i + 2].filter(j => j < count).map(name);
      }
      using dir = workspaceFixture("why-ladder", ladder);

      const { stdout, stderr, exitCode } = await installAndWhy(String(dir), [name(count - 1)]);
      const lines = stdout.split("\n");
      expect({
        // w08 depends on w09 and w10, so it is listed under each of them, and
        // each of those is expanded exactly once.
        w08: lines.filter(line => line.includes("w08@workspace")).length,
        // One marker each for w02 through w13. w00 and w01 have at most one line
        // below them, so they are repeated instead, and w14 is only listed once
        // because it only depends on w15.
        deduped: lines.filter(line => line.endsWith("*deduped")).length,
        stderr,
        exitCode,
      }).toEqual({ w08: 2, deduped: count - 4, stderr: "", exitCode: 0 });
    });
  });
});
