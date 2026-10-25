import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir, tempDirWithFiles, writeBinCommand } from "harness";
import { join } from "node:path";

describe.concurrent("bun pm version", () => {
  let i = 0;

  function setupTest() {
    const testDir = tempDirWithFiles(`version-${i++}`, {
      "package.json": JSON.stringify(
        {
          name: "test-package",
          version: "1.0.0",
        },
        null,
        2,
      ),
    });
    return testDir;
  }

  async function setupGitTest(testDir = setupTest()) {
    await Bun.spawn({
      cmd: ["git", "init"],
      cwd: testDir,
      env: bunEnv,
    }).exited;

    await Bun.spawn({
      cmd: ["git", "config", "user.name", "Test User"],
      cwd: testDir,
      env: bunEnv,
    }).exited;

    await Bun.spawn({
      cmd: ["git", "config", "user.email", "test@example.com"],
      cwd: testDir,
      env: bunEnv,
    }).exited;

    // Signing needs a key that the machine running the test may not have.
    await Bun.spawn({
      cmd: ["git", "config", "commit.gpgsign", "false"],
      cwd: testDir,
      env: bunEnv,
    }).exited;

    await Bun.spawn({
      cmd: ["git", "config", "tag.gpgsign", "false"],
      cwd: testDir,
      env: bunEnv,
    }).exited;

    await Bun.spawn({
      cmd: ["git", "add", "package.json"],
      cwd: testDir,
      env: bunEnv,
    }).exited;

    await Bun.spawn({
      cmd: ["git", "commit", "-m", "Initial commit"],
      cwd: testDir,
      env: bunEnv,
    }).exited;

    return testDir;
  }

  function setupMonorepoTest() {
    const testDir = tempDirWithFiles(`version-${i++}`, {
      "package.json": JSON.stringify(
        {
          name: "monorepo-root",
          version: "1.0.0",
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
      "packages/pkg-a/package.json": JSON.stringify(
        {
          name: "@test/pkg-a",
          version: "2.0.0",
        },
        null,
        2,
      ),
      "packages/pkg-b/package.json": JSON.stringify(
        {
          name: "@test/pkg-b",
          version: "3.0.0",
          dependencies: {
            "@test/pkg-a": "workspace:*",
          },
        },
        null,
        2,
      ),
    });

    return testDir;
  }

  async function runCommand(args: string[], cwd: string, expectSuccess = true) {
    const result = spawn({
      cmd: args,
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [output, error] = await Promise.all([new Response(result.stdout).text(), new Response(result.stderr).text()]);

    const code = await result.exited;

    return { output, error, code };
  }

  describe("help and version previews", () => {
    it("should show help when no arguments provided", async () => {
      const testDir = setupTest();

      const { output, code } = await runCommand([bunExe(), "pm", "version"], testDir);

      expect(code).toBe(0);
      expect(output).toContain("bun pm version");
      expect(output).toContain("Current package version: v1.0.0");
      expect(output).toContain("patch");
      expect(output).toContain("minor");
      expect(output).toContain("major");
    });

    it("shows help with version previews", async () => {
      await using testDir1 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "2.5.3" }, null, 2),
      });

      const { output: output1, code: code1 } = await runCommand([bunExe(), "pm", "version"], testDir1);

      expect(code1).toBe(0);
      expect(output1).toContain("Current package version: v2.5.3");
      expect(output1).toContain("patch      2.5.3 → 2.5.4");
      expect(output1).toContain("minor      2.5.3 → 2.6.0");
      expect(output1).toContain("major      2.5.3 → 3.0.0");

      await using testDir2 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0-alpha.0" }, null, 2),
      });

      const { output: output2, code: code2 } = await runCommand([bunExe(), "pm", "version"], testDir2);

      expect(code2).toBe(0);
      expect(output2).toContain("prepatch");
      expect(output2).toContain("preminor");
      expect(output2).toContain("premajor");
      expect(output2).toContain("prepatch   1.0.0-alpha.0 → 1.0.1-0");
      expect(output2).toContain("preminor   1.0.0-alpha.0 → 1.1.0-0");
      expect(output2).toContain("premajor   1.0.0-alpha.0 → 2.0.0-0");

      await using testDir3 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }, null, 2),
      });

      const { output: output3, code: code3 } = await runCommand(
        [bunExe(), "pm", "version", "--preid", "beta"],
        testDir3,
      );

      expect(code3).toBe(0);
      expect(output3).toContain("prepatch");
      expect(output3).toContain("preminor");
      expect(output3).toContain("premajor");
      expect(output3).toContain("1.0.1-beta.0");
      expect(output3).toContain("1.1.0-beta.0");
      expect(output3).toContain("2.0.0-beta.0");

      await using testDir4 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test" }, null, 2),
      });

      const { output: output4 } = await runCommand([bunExe(), "pm", "version"], testDir4);

      expect(output4).not.toContain("Current package version:");
      expect(output4).toContain("patch      1.0.0 → 1.0.1");
    });
  });

  describe("basic version incrementing", () => {
    it("should increment versions correctly", async () => {
      const testDir = setupTest();

      const { output: patchOutput, code: patchCode } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir,
      );
      expect(patchCode).toBe(0);
      expect(patchOutput.trim()).toBe("v1.0.1");

      const { output: minorOutput, code: minorCode } = await runCommand(
        [bunExe(), "pm", "version", "minor", "--no-git-tag-version"],
        testDir,
      );
      expect(minorCode).toBe(0);
      expect(minorOutput.trim()).toBe("v1.1.0");

      const { output: majorOutput, code: majorCode } = await runCommand(
        [bunExe(), "pm", "version", "major", "--no-git-tag-version"],
        testDir,
      );
      expect(majorCode).toBe(0);
      expect(majorOutput.trim()).toBe("v2.0.0");

      const packageJson = await Bun.file(`${testDir}/package.json`).json();
      expect(packageJson.version).toBe("2.0.0");
    });

    // `npm version patch` writes the same version, although both tools then refuse to increment it again.
    it("increments a number equal to Number.MAX_SAFE_INTEGER", async () => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.9007199254740991" }, null, 2),
      });

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir,
      );

      expect({ output, error, code }).toEqual({ output: "v1.0.9007199254740992\n", error: "", code: 0 });
    });

    it("should set specific version", async () => {
      const testDir = setupTest();

      const { output, code } = await runCommand([bunExe(), "pm", "version", "3.2.1", "--no-git-tag-version"], testDir);

      expect(code).toBe(0);
      expect(output.trim()).toBe("v3.2.1");

      const packageJson = await Bun.file(`${testDir}/package.json`).json();
      expect(packageJson.version).toBe("3.2.1");
    });

    // Like `npm version`, which writes `semver.clean(version)`.
    it.each([
      ["v2.0.0", "2.0.0"],
      ["=2.0.0", "2.0.0"],
      ["2.0.0+build.7", "2.0.0"],
      ["v2.0.0-rc.1+build.7", "2.0.0-rc.1"],
    ])("writes the specific version %s as %s", async (arg, expected) => {
      const testDir = setupTest();

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", arg, "--no-git-tag-version"],
        testDir,
      );
      const packageJson = await Bun.file(join(testDir, "package.json")).json();

      expect({ output, error, code, version: packageJson.version }).toEqual({
        output: `v${expected}\n`,
        error: "",
        code: 0,
        version: expected,
      });
    });

    it("handles empty package.json", async () => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": "{}",
      });

      const { output, code } = await runCommand([bunExe(), "pm", "version", "patch", "--no-git-tag-version"], testDir);

      expect(code).toBe(0);
      expect(output.trim()).toBe("v0.0.1");

      const packageJson = await Bun.file(`${testDir}/package.json`).json();
      expect(packageJson.version).toBe("0.0.1");
    });
  });

  describe("error handling", () => {
    it("handles various error conditions", async () => {
      await using testDir2 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "invalid-version" }, null, 2),
      });

      const { error: error2, code: code2 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir2,
        false,
      );
      expect(error2).toContain("is not a valid semver");
      expect(code2).toBe(1);

      const testDir3 = setupTest();

      const { error: error3, code: code3 } = await runCommand(
        [bunExe(), "pm", "version", "invalid-arg", "--no-git-tag-version"],
        testDir3,
        false,
      );
      expect(error3).toContain("Invalid version argument");
      expect(code3).toBe(1);

      const testDir4 = setupTest();

      const { error: error4, code: code4 } = await runCommand(
        [bunExe(), "pm", "version", "1.0.0", "--no-git-tag-version"],
        testDir4,
        false,
      );
      expect(error4).toContain("Version not changed");
      expect(code4).toBe(1);

      const { output: output5, code: code5 } = await runCommand(
        [bunExe(), "pm", "version", "1.0.0", "--no-git-tag-version", "--allow-same-version"],
        testDir4,
      );
      expect(output5.trim()).toBe("v1.0.0");
      expect(code5).toBe(0);
    });

    // `npm version` rejects these too (node-semver: "Invalid patch version"). The number used to wrap:
    // the first three wrote 1.0.0, 1.0.0 and 0.0.0, and the `+ 1` aborted a debug build.
    it.each([
      ["1.0.18446744073709551615", "patch"],
      ["1.18446744073709551615.0", "minor"],
      ["18446744073709551615.0.0", "major"],
      ["1.0.18446744073709551615", "prerelease"],
      ["1.0.9007199254740992", "patch"],
    ])("rejects %s as the version to increment with %s", async (version, increment) => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version }, null, 2),
      });

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", increment, "--no-git-tag-version"],
        testDir,
        false,
      );
      const packageJson = await Bun.file(join(String(testDir), "package.json")).json();

      expect({ output, error, code, version: packageJson.version }).toEqual({
        output: "",
        error: `error: Current version "${version}" is not a valid semver\n`,
        code: 1,
        version,
      });
    });

    // The same limit applies to a version given as the argument. `npm version` prints "Invalid version".
    it("rejects a specific version with a number above Number.MAX_SAFE_INTEGER", async () => {
      const testDir = setupTest();

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", "1.0.9007199254740992", "--no-git-tag-version"],
        testDir,
        false,
      );
      const packageJson = await Bun.file(join(testDir, "package.json")).json();

      expect({ output, error: error.split("\n")[0], code, version: packageJson.version }).toEqual({
        output: "",
        error: 'error: Invalid version argument: "1.0.9007199254740992"',
        code: 1,
        version: "1.0.0",
      });
    });

    it.each(["2", "2.0", "x", "2.x", "^2.0.0", "2.0.0 || 3.0.0", "2.0.0.0", "2.0.0-a..b"])(
      "rejects %s as the specific version",
      async arg => {
        const testDir = setupTest();

        const { output, error, code } = await runCommand(
          [bunExe(), "pm", "version", arg, "--no-git-tag-version"],
          testDir,
          false,
        );
        const packageJson = await Bun.file(join(testDir, "package.json")).json();

        expect({ output, error: error.split("\n")[0], code, version: packageJson.version }).toEqual({
          output: "",
          error: `error: Invalid version argument: "${arg}"`,
          code: 1,
          version: "1.0.0",
        });
      },
    );

    it.each(["be ta", "beta!", "a..b", ".a", "01", "00", "beta.007"])("rejects %j as the --preid", async preid => {
      const testDir = setupTest();

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--preid", preid, "--no-git-tag-version"],
        testDir,
        false,
      );
      const packageJson = await Bun.file(join(testDir, "package.json")).json();

      expect({ output, error, code, version: packageJson.version }).toEqual({
        output: "",
        error: `error: Invalid --preid: "${preid}"\n`,
        code: 1,
        version: "1.0.0",
      });
    });

    it("handles missing package.json like npm", async () => {
      await using testDir = tempDir(`version-${i++}`, {
        "README.md": "# Test project",
      });

      const { error, code } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir,
        false,
      );
      expect(error).toContain("package.json");
      expect(code).toBe(1);
      // its an ealier check that "bun pm *" commands do so not "bun pm version" specific
      // expect(error.includes("ENOENT") || error.includes("no such file")).toBe(true);
    });

    it("handles empty string package.json like npm", async () => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": '""',
      });

      const { error, code } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir,
        false,
      );
      expect(error).toContain("Failed to parse package.json");
      expect(code).toBe(1);
    });

    it("handles malformed JSON like npm", async () => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": '{ "name": "test", invalid json }',
      });

      const { error, code } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir,
        false,
      );
      expect(error).toContain("Failed to parse package.json");
      expect(code).toBe(1);
    });
  });

  describe("git integration", () => {
    it("creates git commits and tags by default", async () => {
      const testDir1 = await setupGitTest();

      const {
        output: output1,
        code: code1,
        error: stderr1,
      } = await runCommand([bunExe(), "pm", "version", "patch"], testDir1);

      expect(stderr1.trim()).toBe("");
      expect(output1.trim()).toBe("v1.0.1");
      expect(code1).toBe(0);

      const { output: tagOutput } = await runCommand(["git", "tag", "-l"], testDir1);
      expect(tagOutput).toContain("v1.0.1");

      const { output: logOutput } = await runCommand(["git", "log", "--oneline"], testDir1);
      expect(logOutput).toContain("v1.0.1");
    });

    it("creates git commits and tags inside a linked worktree", async () => {
      const mainDir = await setupGitTest();
      const worktreeDir = join(tempDirWithFiles(`version-${i++}`, { ".keep": "" }), "worktree");

      const { code: addCode } = await runCommand(["git", "worktree", "add", worktreeDir, "-b", "release"], mainDir);
      expect(addCode).toBe(0);

      // A linked worktree has a `.git` file, not a `.git` directory.
      expect(await Bun.file(join(worktreeDir, ".git")).text()).toStartWith("gitdir:");

      const { output, error, code } = await runCommand([bunExe(), "pm", "version", "patch"], worktreeDir);

      expect(error.trim()).toBe("");
      expect(output.trim()).toBe("v1.0.1");
      expect(code).toBe(0);

      const { output: tagOutput } = await runCommand(["git", "tag", "-l"], worktreeDir);
      expect(tagOutput).toContain("v1.0.1");

      const { output: logOutput } = await runCommand(["git", "log", "--oneline"], worktreeDir);
      expect(logOutput).toContain("v1.0.1");
    });

    // One commit per tag, oldest first. `null`: no version to take, as for `npm version from-git`.
    it.each([
      [["v9.9.9"], "9.9.9"],
      [["other-9.9.9"], "9.9.9"],
      [["pkg@2.0.0-beta.1"], "2.0.0-beta.1"],
      [["v3.0.0", "nightly"], "3.0.0"],
      [["nightly"], null],
      [["a.b.c"], null],
    ] as const)("from-git with the tags %j writes %j", async (tags, expected) => {
      const testDir = await setupGitTest();
      for (const tag of tags) {
        await runCommand(["git", "commit", "--allow-empty", "-m", tag], testDir);
        await runCommand(["git", "tag", "-a", tag, "-m", tag], testDir);
      }

      const { output, code } = await runCommand(
        [bunExe(), "pm", "version", "from-git", "--no-git-tag-version"],
        testDir,
        expected !== null,
      );
      const packageJson = await Bun.file(join(testDir, "package.json")).json();

      expect({ output, code, version: packageJson.version }).toEqual(
        expected === null
          ? { output: "", code: 1, version: "1.0.0" }
          : { output: `v${expected}\n`, code: 0, version: expected },
      );
    });

    it("supports custom commit messages", async () => {
      const testDir2 = await setupGitTest();

      const {
        output: output2,
        error: error2,
        code: code2,
      } = await runCommand([bunExe(), "pm", "version", "patch", "--message", "Custom release message"], testDir2);
      expect(error2).toBe("");

      const { output: gitLogOutput } = await runCommand(["git", "log", "--oneline"], testDir2);
      expect(gitLogOutput).toContain("Custom release message");

      expect(code2).toBe(0);
      expect(output2.trim()).toBe("v1.0.1");
    });

    it("fails when git working directory is not clean", async () => {
      const testDir3 = await setupGitTest();

      await Bun.write(join(testDir3, "untracked.txt"), "untracked content");

      const { error: error3, code: code3 } = await runCommand([bunExe(), "pm", "version", "patch"], testDir3, false);

      expect(error3).toContain("Git working directory not clean");
      expect(code3).toBe(1);
    });

    it("allows dirty working directory with --force flag", async () => {
      const testDir = await setupGitTest();

      await Bun.write(join(testDir, "untracked.txt"), "untracked content");

      const { output, code, error } = await runCommand([bunExe(), "pm", "version", "patch", "--force"], testDir);

      expect(code).toBe(0);
      expect(error.trim()).toBe("");
      expect(output.trim()).toBe("v1.0.1");

      const { output: tagOutput } = await runCommand(["git", "tag", "-l"], testDir);
      expect(tagOutput).toContain("v1.0.1");

      const { output: logOutput } = await runCommand(["git", "log", "--oneline"], testDir);
      expect(logOutput).toContain("v1.0.1");
    });

    it("works without git when no repo is present", async () => {
      const testDir4 = setupTest();

      const { output: output4, code: code4 } = await runCommand([bunExe(), "pm", "version", "patch"], testDir4);

      expect(code4).toBe(0);
      expect(output4.trim()).toBe("v1.0.1");

      const packageJson = await Bun.file(`${testDir4}/package.json`).json();
      expect(packageJson.version).toBe("1.0.1");
    });

    it("respects --no-git-tag-version flag", async () => {
      const testDir5 = await setupGitTest();
      const { output: output5, code: code5 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir5,
      );

      expect(code5).toBe(0);
      expect(output5.trim()).toBe("v1.0.1");

      const packageJson5 = await Bun.file(`${testDir5}/package.json`).json();
      expect(packageJson5.version).toBe("1.0.1");

      const { output: tagOutput5 } = await runCommand(["git", "tag", "-l"], testDir5);
      expect(tagOutput5.trim()).toBe("");

      const { output: logOutput5 } = await runCommand(["git", "log", "--oneline"], testDir5);
      expect(logOutput5).toContain("Initial commit");
      expect(logOutput5).not.toContain("v1.0.1");
    });

    it("respects --git-tag-version=false flag", async () => {
      const testDir6 = await setupGitTest();
      const { output: output6, code: code6 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--git-tag-version=false"],
        testDir6,
      );

      expect(code6).toBe(0);
      expect(output6.trim()).toBe("v1.0.1");

      const packageJson6 = await Bun.file(`${testDir6}/package.json`).json();
      expect(packageJson6.version).toBe("1.0.1");

      const { output: tagOutput6 } = await runCommand(["git", "tag", "-l"], testDir6);
      expect(tagOutput6.trim()).toBe("");

      const { output: logOutput6 } = await runCommand(["git", "log", "--oneline"], testDir6);
      expect(logOutput6).toContain("Initial commit");
      expect(logOutput6).not.toContain("v1.0.1");
    });

    it("respects --git-tag-version=true flag", async () => {
      const testDir7 = await setupGitTest();
      const { output: output7, code: code7 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--git-tag-version=true"],
        testDir7,
      );

      expect(code7).toBe(0);
      expect(output7.trim()).toBe("v1.0.1");

      const packageJson7 = await Bun.file(`${testDir7}/package.json`).json();
      expect(packageJson7.version).toBe("1.0.1");

      const { output: tagOutput7 } = await runCommand(["git", "tag", "-l"], testDir7);
      expect(tagOutput7).toContain("v1.0.1");

      const { output: logOutput7 } = await runCommand(["git", "log", "--oneline"], testDir7);
      expect(logOutput7).toContain("v1.0.1");
    });

    it("supports %s substitution in commit messages", async () => {
      const testDir8 = await setupGitTest();
      const { output: output8, code: code8 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--message", "Bump version to %s"],
        testDir8,
      );

      expect(code8).toBe(0);
      expect(output8.trim()).toBe("v1.0.1");

      const { output: logOutput8 } = await runCommand(["git", "log", "--oneline", "-1"], testDir8);
      expect(logOutput8).toContain("Bump version to 1.0.1");

      const testDir9 = await setupGitTest();
      const { output: output9, code: code9 } = await runCommand(
        [bunExe(), "pm", "version", "2.5.0", "-m", "Release %s with fixes"],
        testDir9,
      );

      expect(code9).toBe(0);
      expect(output9.trim()).toBe("v2.5.0");

      const { output: logOutput9 } = await runCommand(["git", "log", "--oneline", "-1"], testDir9);
      expect(logOutput9).toContain("Release 2.5.0 with fixes");
    });
  });

  describe("--dry-run", () => {
    it("prints the new version without writing package.json or running scripts", async () => {
      using testDir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify(
          {
            name: "test",
            version: "1.0.0",
            scripts: {
              preversion: "echo 'step1' >> lifecycle.log",
              version: "echo 'step2' >> lifecycle.log",
              postversion: "echo 'step3' >> lifecycle.log",
            },
          },
          null,
          2,
        ),
      });

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", "minor", "--dry-run", "--no-git-tag-version"],
        String(testDir),
      );

      expect(error).toBe("");
      expect(output).toBe("v1.1.0\n");
      expect(code).toBe(0);

      const pkg = await Bun.file(join(String(testDir), "package.json")).json();
      expect(pkg.version).toBe("1.0.0");
      expect(await Bun.file(join(String(testDir), "lifecycle.log")).exists()).toBe(false);
    });

    it("does not commit or tag in a git repository", async () => {
      const testDir = await setupGitTest();

      const { output, error, code } = await runCommand([bunExe(), "pm", "version", "patch", "--dry-run"], testDir);

      expect(error).toBe("");
      expect(output).toBe("v1.0.1\n");
      expect(code).toBe(0);

      const pkg = await Bun.file(join(testDir, "package.json")).json();
      expect(pkg.version).toBe("1.0.0");

      const { output: tagOutput } = await runCommand(["git", "tag", "-l"], testDir);
      expect(tagOutput).toBe("");

      const { output: logOutput } = await runCommand(["git", "log", "--format=%s"], testDir);
      expect(logOutput).toBe("Initial commit\n");
    });
  });

  describe("JSON formatting preservation", () => {
    it("preserves JSON formatting correctly", async () => {
      const originalJson1 = `{
            "name": "test",
            "version": "1.0.0",
            "scripts": {
                      "test": "echo test"
            },
            "dependencies": {
            "lodash": "^4.17.21"
            }
  }`;

      await using testDir1 = tempDir(`version-${i++}`, {
        "package.json": originalJson1,
      });

      const { output: output1, code: code1 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        testDir1,
      );

      expect(code1).toBe(0);
      expect(output1.trim()).toBe("v1.0.1");

      const updatedJson1 = await Bun.file(`${testDir1}/package.json`).text();

      expect(updatedJson1).toContain('            "version": "1.0.1"');
      expect(updatedJson1).toContain('"name": "test"');
      expect(updatedJson1).toContain('                      "test": "echo test"');

      expect(JSON.parse(updatedJson1)).toMatchObject({
        name: "test",
        version: "1.0.1",
        scripts: {
          test: "echo test",
        },
      });
    });

    it("keeps the file valid JSON when a number literal overflows to Infinity", async () => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": `{
  "name": "test",
  "version": "1.0.0",
  "config": { "max": 1e400, "min": -1e400 }
}`,
      });

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        String(testDir),
      );
      expect(error).toBe("");
      expect(output.trim()).toBe("v1.0.1");
      expect(code).toBe(0);

      expect(JSON.parse(await Bun.file(join(String(testDir), "package.json")).text())).toEqual({
        name: "test",
        version: "1.0.1",
        config: { max: null, min: null },
      });
    });
  });

  describe("prerelease handling", () => {
    it("handles custom preid and prerelease scenarios", async () => {
      await using testDir1 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }, null, 2),
      });

      const { output: output1, code: code1 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--preid", "beta", "--no-git-tag-version"],
        testDir1,
      );

      expect(code1).toBe(0);
      expect(output1.trim()).toBe("v1.0.1-beta.0");

      await using testDir3 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }, null, 2),
      });

      const { output: output3, code: code3 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--no-git-tag-version"],
        testDir3,
      );

      expect(code3).toBe(0);
      expect(output3.trim()).toBe("v1.0.1-0");

      await using testDir5 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0-alpha" }, null, 2),
      });

      const { output: output5, code: code5 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--no-git-tag-version"],
        testDir5,
      );

      expect(code5).toBe(0);
      expect(output5.trim()).toBe("v1.0.0-alpha.0");

      await using testDir6 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0-3" }, null, 2),
      });

      const { output: output6, code: code6 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--no-git-tag-version"],
        testDir6,
      );

      expect(code6).toBe(0);
      expect(output6.trim()).toBe("v1.0.0-4");
    });

    // The last column is `semver.inc(version, increment, preid)` of node-semver 7.8.1, which is what `npm version` writes.
    it.each([
      // A prerelease of x.0.0, x.y.0 or x.y.z becomes that release, not the one after it.
      ["1.0.0-rc.1", "major", "1.0.0"],
      ["1.2.0-rc.1", "major", "2.0.0"],
      ["1.2.0-rc.1", "minor", "1.2.0"],
      ["1.2.3-rc.1", "minor", "1.3.0"],
      ["1.2.3-beta.1", "patch", "1.2.3"],
      ["1.2.3", "major", "2.0.0"],
      ["1.2.3", "minor", "1.3.0"],
      ["1.2.3", "patch", "1.2.4"],
      ["1.2.3", "premajor", "2.0.0-0"],
      ["1.2.3", "preminor", "1.3.0-0"],
      ["1.2.3", "prepatch", "1.2.4-0"],
      ["1.2.3", "prerelease", "1.2.4-0"],
      ["1.2.3", "premajor --preid beta", "2.0.0-beta.0"],
      ["1.2.3", "preminor --preid beta", "1.3.0-beta.0"],
      ["1.2.3", "prepatch --preid beta", "1.2.4-beta.0"],
      ["1.2.3", "prerelease --preid beta", "1.2.4-beta.0"],
      // Only --preid names the new prerelease: the current one is not carried over.
      ["1.2.3-beta.1", "premajor", "2.0.0-0"],
      ["1.2.3-beta.1", "preminor", "1.3.0-0"],
      ["1.2.3-beta.1", "prepatch", "1.2.4-0"],
      ["1.2.3-beta.1", "prepatch --preid rc", "1.2.4-rc.0"],
      ["1.2.3-beta.1", "prerelease", "1.2.3-beta.2"],
      ["1.2.3-beta.1", "prerelease --preid beta", "1.2.3-beta.2"],
      // Another name starts to count from 0.
      ["1.2.3-beta.1", "prerelease --preid rc", "1.2.3-rc.0"],
      ["1.0.0-4294967295", "prerelease --preid rc", "1.0.0-rc.0"],
      ["1.2.3-0", "prerelease --preid beta", "1.2.3-beta.0"],
      ["1.2.3-0", "prerelease", "1.2.3-1"],
      ["1.2.3-beta", "prerelease", "1.2.3-beta.0"],
      ["1.2.3-beta", "prerelease --preid beta", "1.2.3-beta.0"],
      ["1.0.0-beta.x", "prerelease --preid beta", "1.0.0-beta.0"],
      ["1.0.0-5", "prerelease --preid 5", "1.0.0-5.0"],
      ["1.0.0", "prerelease --preid 0", "1.0.1-0.0"],
      ["1.0.0", "prerelease --preid 01a", "1.0.1-01a.0"],
      ["1.0.0", "prerelease --preid 0-1", "1.0.1-0-1.0"],
      ["1.2.3", "prerelease --preid a.b", "1.2.4-a.b.0"],
      // The last number is the one that's incremented, wherever it is, and the other fields are kept.
      ["1.0.0-x.7.z.92", "prerelease", "1.0.0-x.7.z.93"],
      ["1.0.0-alpha.1.beta", "prerelease", "1.0.0-alpha.2.beta"],
      ["1.0.0-alpha.beta", "prerelease", "1.0.0-alpha.beta.0"],
      ["1.0.0-beta.1.2", "prerelease --preid beta", "1.0.0-beta.1.3"],
      ["1.2.3+build.5", "patch", "1.2.4"],
      ["1.2.3-beta.1+build.5", "prerelease", "1.2.3-beta.2"],
      ["v1.2.3", "patch", "1.2.4"],
      // The number used to be read as a u32: 4294967295 wrapped to 0 and a build timestamp counted as 0.
      ["1.0.0-beta.4294967295", "prerelease", "1.0.0-beta.4294967296"],
      ["1.0.0-4294967295", "prerelease", "1.0.0-4294967296"],
      ["1.0.0-canary.20250101123456", "prerelease", "1.0.0-canary.20250101123457"],
      ["1.0.0-20250101123456", "prerelease", "1.0.0-20250101123457"],
      ["1.0.0-beta.9007199254740990", "prerelease", "1.0.0-beta.9007199254740991"],
      // Digits from Number.MAX_SAFE_INTEGER up count as a name, so a new field is added.
      ["1.0.0-beta.9007199254740991", "prerelease", "1.0.0-beta.9007199254740991.0"],
      ["1.0.0-beta.18446744073709551614", "prerelease", "1.0.0-beta.18446744073709551614.0"],
      ["1.0.0-18446744073709551615", "prerelease", "1.0.0-18446744073709551615.0"],
      ["1.0.9007199254740991-0", "prerelease", "1.0.9007199254740991-1"],
    ])("%s + %s is %s", async (version, increment, expected) => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version }, null, 2),
      });

      const { output, error, code } = await runCommand(
        [bunExe(), "pm", "version", ...increment.split(" "), "--no-git-tag-version"],
        testDir,
      );
      const packageJson = await Bun.file(join(String(testDir), "package.json")).json();

      expect({ output, error, code, version: packageJson.version }).toEqual({
        output: `v${expected}\n`,
        error: "",
        code: 0,
        version: expected,
      });
    });

    it("previews what each increment of a prerelease would write", async () => {
      const scenarios = [
        {
          version: "1.0.3-alpha.1",
          preid: "beta",
          expected: {
            patch: "1.0.3-alpha.1 → 1.0.3",
            minor: "1.0.3-alpha.1 → 1.1.0",
            major: "1.0.3-alpha.1 → 2.0.0",
            prerelease: "1.0.3-alpha.1 → 1.0.3-beta.0",
            prepatch: "1.0.3-alpha.1 → 1.0.4-beta.0",
            preminor: "1.0.3-alpha.1 → 1.1.0-beta.0",
            premajor: "1.0.3-alpha.1 → 2.0.0-beta.0",
          },
        },
        {
          version: "1.0.3-1",
          preid: "abcd",
          expected: {
            patch: "1.0.3-1 → 1.0.3",
            minor: "1.0.3-1 → 1.1.0",
            major: "1.0.3-1 → 2.0.0",
            prerelease: "1.0.3-1 → 1.0.3-abcd.0",
            prepatch: "1.0.3-1 → 1.0.4-abcd.0",
            preminor: "1.0.3-1 → 1.1.0-abcd.0",
            premajor: "1.0.3-1 → 2.0.0-abcd.0",
          },
        },
        {
          version: "2.5.0-rc.3",
          preid: "next",
          expected: {
            patch: "2.5.0-rc.3 → 2.5.0",
            minor: "2.5.0-rc.3 → 2.5.0",
            major: "2.5.0-rc.3 → 3.0.0",
            prerelease: "2.5.0-rc.3 → 2.5.0-next.0",
            prepatch: "2.5.0-rc.3 → 2.5.1-next.0",
            preminor: "2.5.0-rc.3 → 2.6.0-next.0",
            premajor: "2.5.0-rc.3 → 3.0.0-next.0",
          },
        },
        {
          version: "1.0.0-a",
          preid: "b",
          expected: {
            patch: "1.0.0-a → 1.0.0",
            minor: "1.0.0-a → 1.0.0",
            major: "1.0.0-a → 1.0.0",
            prerelease: "1.0.0-a → 1.0.0-b.0",
            prepatch: "1.0.0-a → 1.0.1-b.0",
            preminor: "1.0.0-a → 1.1.0-b.0",
            premajor: "1.0.0-a → 2.0.0-b.0",
          },
        },
      ];

      for (const scenario of scenarios) {
        await using testDir = tempDir(`version-${i++}`, {
          "package.json": JSON.stringify({ name: "test", version: scenario.version }, null, 2),
        });

        const { output, code } = await runCommand(
          [bunExe(), "pm", "version", "--no-git-tag-version", `--preid=${scenario.preid}`],
          testDir,
        );

        expect(code).toBe(0);
        expect(output).toContain(`Current package version: v${scenario.version}`);

        for (const [incrementType, expectedTransformation] of Object.entries(scenario.expected)) {
          expect(output).toContain(`${incrementType.padEnd(10)} ${expectedTransformation}\n`);
        }
      }

      await using testDir2 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.3-alpha.1" }, null, 2),
      });

      const { output: output2, code: code2 } = await runCommand(
        [bunExe(), "pm", "version", "--no-git-tag-version"],
        testDir2,
      );

      expect(code2).toBe(0);
      expect(output2).toContain("prerelease 1.0.3-alpha.1 → 1.0.3-alpha.2");
    });
  });

  describe("lifecycle scripts", () => {
    it("run the commands in node_modules/.bin", async () => {
      using dir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({
          name: "test",
          version: "1.0.0",
          scripts: { preversion: "tool", version: "tool", postversion: "tool" },
        }),
      });
      writeBinCommand(String(dir), "tool", "tool of the package");

      await using proc = Bun.spawn([bunExe(), "pm", "version", "patch", "--no-git-tag-version"], {
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(err).toBe("$ tool\n$ tool\n$ tool\n");
      expect(out.match(/^tool of .*$/gm)).toEqual(Array(3).fill("tool of the package"));
      expect(exitCode).toBe(0);
    });

    it("see the versions in the variables npm sets", async () => {
      const script =
        'echo "$npm_lifecycle_event: $npm_command $npm_package_name@$npm_package_version, $npm_old_version to $npm_new_version" >> seen.txt';
      using dir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({
          name: "test",
          version: "1.0.0",
          scripts: { preversion: script, version: script, postversion: script },
        }),
      });

      const { output, code } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        String(dir),
      );

      expect((await Bun.file(join(String(dir), "seen.txt")).text()).split("\n")).toEqual([
        "preversion: version test@1.0.0, 1.0.0 to 1.0.1",
        "version: version test@1.0.1, 1.0.0 to 1.0.1",
        "postversion: version test@1.0.1, 1.0.0 to 1.0.1",
        "",
      ]);
      expect(output).toBe("v1.0.1\n");
      expect(code).toBe(0);
    });

    // The default case: git runs before the first script and between the scripts.
    it.each([
      ["default", ""],
      ["bun", '[run]\nshell = "bun"\n'],
    ])("have their whole environment in a clean git repository, with the %s shell", async (_, bunfig) => {
      const script =
        'echo "$npm_lifecycle_event: $npm_command $npm_package_name@$npm_package_version, $npm_old_version to $npm_new_version, $MARK" && tool';
      using dir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({
          name: "test",
          version: "1.0.0",
          scripts: { preversion: script, version: script, postversion: script },
        }),
        "bunfig.toml": bunfig,
      });
      await setupGitTest(String(dir));
      await Bun.write(join(String(dir), ".git", "info", "exclude"), "node_modules\nbunfig.toml\n");
      writeBinCommand(String(dir), "tool", "tool of the package");

      await using proc = Bun.spawn([bunExe(), "pm", "version", "patch"], {
        cwd: String(dir),
        env: { ...bunEnv, MARK: "from-parent" },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [out, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(out.split(/\r?\n/)).toEqual([
        "preversion: version test@1.0.0, 1.0.0 to 1.0.1, from-parent",
        "tool of the package",
        "version: version test@1.0.1, 1.0.0 to 1.0.1, from-parent",
        "tool of the package",
        "postversion: version test@1.0.1, 1.0.0 to 1.0.1, from-parent",
        "tool of the package",
        "v1.0.1",
        "",
      ]);
      expect((await runCommand(["git", "tag", "-l"], String(dir))).output).toBe("v1.0.1\n");
      expect(exitCode).toBe(0);
    });

    it("runs lifecycle scripts in correct order and handles failures", async () => {
      await using testDir1 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify(
          {
            name: "test",
            version: "1.0.0",
            scripts: {
              preversion: "echo 'step1' >> lifecycle.log",
              version: "echo 'step2' >> lifecycle.log",
              postversion: "echo 'step3' >> lifecycle.log",
            },
          },
          null,
          2,
        ),
      });

      await Bun.spawn([bunExe(), "pm", "version", "patch", "--no-git-tag-version"], {
        cwd: testDir1,
        env: bunEnv,
        stderr: "ignore",
        stdout: "ignore",
      }).exited;

      expect(await Bun.file(join(testDir1, "lifecycle.log")).exists()).toBe(true);
      const logContent = await Bun.file(join(testDir1, "lifecycle.log")).text();
      expect(logContent.trim()).toBe("step1\nstep2\nstep3");

      await using testDir2 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify(
          {
            name: "test",
            version: "1.0.0",
            scripts: {
              preversion: "echo $npm_lifecycle_event > event.log && echo $npm_lifecycle_script > script.log",
            },
          },
          null,
          2,
        ),
      });

      await Bun.spawn([bunExe(), "pm", "version", "patch", "--no-git-tag-version"], {
        cwd: testDir2,
        env: bunEnv,
        stderr: "ignore",
        stdout: "ignore",
      }).exited;

      await expect(Bun.file(join(testDir2, "event.log")).exists()).resolves.toBe(true);
      await expect(Bun.file(join(testDir2, "script.log")).exists()).resolves.toBe(true);

      const eventContent = await Bun.file(join(testDir2, "event.log")).text();
      const scriptContent = await Bun.file(join(testDir2, "script.log")).text();

      expect(eventContent.trim()).toBe("preversion");
      expect(scriptContent.trim()).toContain("echo $npm_lifecycle_event");

      await using testDir3 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify(
          {
            name: "test",
            version: "1.0.0",
            scripts: {
              preversion: "exit 1",
            },
          },
          null,
          2,
        ),
      });

      const proc = Bun.spawn([bunExe(), "pm", "version", "minor", "--no-git-tag-version"], {
        cwd: testDir3,
        env: bunEnv,
        stderr: "pipe",
        stdout: "ignore",
      });

      await proc.exited;
      expect(proc.exitCode).toBe(1);
      expect(await proc.stderr.text()).toContain('script "preversion" exited with code 1');

      const packageJson = await Bun.file(join(testDir3, "package.json")).json();
      expect(packageJson.version).toBe("1.0.0");

      await using testDir4 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify(
          {
            name: "test",
            version: "1.0.0",
            scripts: {
              preversion: "mkdir -p build && echo 'built' > build/output.txt",
              version: "cp build/output.txt version-output.txt",
              postversion: "rm -rf build",
            },
          },
          null,
          2,
        ),
      });

      await Bun.spawn([bunExe(), "pm", "version", "patch", "--no-git-tag-version"], {
        cwd: testDir4,
        env: bunEnv,
        stderr: "ignore",
        stdout: "ignore",
      }).exited;

      await expect(Bun.file(join(testDir4, "version-output.txt")).exists()).resolves.toBe(true);
      await expect(Bun.file(join(testDir4, "build")).exists()).resolves.toBe(false);

      const content = await Bun.file(join(testDir4, "version-output.txt")).text();
      expect(content.trim()).toBe("built");

      await using testDir5 = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify(
          {
            name: "test",
            version: "1.0.0",
            scripts: {
              preversion: "echo 'should not run' >> ignored.log",
              version: "echo 'should not run' >> ignored.log",
              postversion: "echo 'should not run' >> ignored.log",
            },
          },
          null,
          2,
        ),
      });

      const { output: output5, code: code5 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version", "--ignore-scripts"],
        testDir5,
      );

      expect(code5).toBe(0);
      expect(output5.trim()).toBe("v1.0.1");

      const packageJson5 = await Bun.file(join(testDir5, "package.json")).json();
      expect(packageJson5.version).toBe("1.0.1");

      expect(await Bun.file(join(testDir5, "ignored.log")).exists()).toBe(false);
    });
  });

  describe("workspace and directory handling", () => {
    it("should version workspace packages individually", async () => {
      const testDir = setupMonorepoTest();

      const { output: outputA, code: codeA } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        join(testDir, "packages", "pkg-a"),
      );

      expect(codeA).toBe(0);
      expect(outputA.trim()).toBe("v2.0.1");

      const rootPackageJson = await Bun.file(`${testDir}/package.json`).json();
      expect(rootPackageJson.version).toBe("1.0.0");

      const pkgAJson = await Bun.file(`${testDir}/packages/pkg-a/package.json`).json();
      const pkgBJson = await Bun.file(`${testDir}/packages/pkg-b/package.json`).json();

      expect(pkgAJson.version).toBe("2.0.1");
      expect(pkgBJson.version).toBe("3.0.0");
    });

    it("should work from subdirectories", async () => {
      await using testDir = tempDir(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }, null, 2),
        "src/index.js": "console.log('hello');",
      });

      const { output, code } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--no-git-tag-version"],
        join(testDir, "src"),
      );

      expect(code).toBe(0);
      expect(output.trim()).toBe("v1.0.1");

      const packageJson = await Bun.file(`${testDir}/package.json`).json();
      expect(packageJson.version).toBe("1.0.1");

      const monorepoDir = setupMonorepoTest();

      await Bun.write(join(monorepoDir, "packages", "pkg-a", "lib", "index.js"), "");

      const { output: output2, code: code2 } = await runCommand(
        [bunExe(), "pm", "version", "minor", "--no-git-tag-version"],
        join(monorepoDir, "packages", "pkg-a", "lib"),
      );

      expect(code2).toBe(0);
      expect(output2.trim()).toBe("v2.1.0");

      const rootJson = await Bun.file(`${monorepoDir}/package.json`).json();
      const pkgAJson = await Bun.file(`${monorepoDir}/packages/pkg-a/package.json`).json();
      const pkgBJson = await Bun.file(`${monorepoDir}/packages/pkg-b/package.json`).json();

      expect(rootJson.version).toBe("1.0.0");
      expect(pkgAJson.version).toBe("2.1.0");
      expect(pkgBJson.version).toBe("3.0.0");
    });
  });
});
