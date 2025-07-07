import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "node:path";

describe("bun pm version", () => {
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

  function setupGitTest() {
    const testDir = setupTest();

    spawnSync({
      cmd: ["git", "init"],
      cwd: testDir,
      env: bunEnv,
    });

    spawnSync({
      cmd: ["git", "config", "user.name", "Test User"],
      cwd: testDir,
      env: bunEnv,
    });

    spawnSync({
      cmd: ["git", "config", "user.email", "test@example.com"],
      cwd: testDir,
      env: bunEnv,
    });

    spawnSync({
      cmd: ["git", "add", "package.json"],
      cwd: testDir,
      env: bunEnv,
    });

    spawnSync({
      cmd: ["git", "commit", "-m", "Initial commit"],
      cwd: testDir,
      env: bunEnv,
    });

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
      const testDir1 = tempDirWithFiles(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "2.5.3" }, null, 2),
      });

      const { output: output1, code: code1 } = await runCommand([bunExe(), "pm", "version"], testDir1);

      expect(code1).toBe(0);
      expect(output1).toContain("Current package version: v2.5.3");
      expect(output1).toContain("patch      2.5.3 → 2.5.4");
      expect(output1).toContain("minor      2.5.3 → 2.6.0");
      expect(output1).toContain("major      2.5.3 → 3.0.0");

      const testDir2 = tempDirWithFiles(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0-alpha.0" }, null, 2),
      });

      const { output: output2, code: code2 } = await runCommand([bunExe(), "pm", "version"], testDir2);

      expect(code2).toBe(0);
      expect(output2).toContain("prepatch");
      expect(output2).toContain("preminor");
      expect(output2).toContain("premajor");
      expect(output2).toContain("1.0.1-alpha.0");
      expect(output2).toContain("1.1.0-alpha.0");
      expect(output2).toContain("2.0.0-alpha.0");

      const testDir3 = tempDirWithFiles(`version-${i++}`, {
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

      const testDir4 = tempDirWithFiles(`version-${i++}`, {
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

    it("should set specific version", async () => {
      const testDir = setupTest();

      const { output, code } = await runCommand([bunExe(), "pm", "version", "3.2.1", "--no-git-tag-version"], testDir);

      expect(code).toBe(0);
      expect(output.trim()).toBe("v3.2.1");

      const packageJson = await Bun.file(`${testDir}/package.json`).json();
      expect(packageJson.version).toBe("3.2.1");
    });

    it("handles empty package.json", async () => {
      const testDir = tempDirWithFiles(`version-${i++}`, {
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
      const testDir2 = tempDirWithFiles(`version-${i++}`, {
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

    it("handles missing package.json like npm", async () => {
      const testDir = tempDirWithFiles(`version-${i++}`, {
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
      const testDir = tempDirWithFiles(`version-${i++}`, {
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
      const testDir = tempDirWithFiles(`version-${i++}`, {
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
      const testDir1 = setupGitTest();

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

    it("supports custom commit messages", async () => {
      const testDir2 = setupGitTest();

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
      const testDir3 = setupGitTest();

      await Bun.write(join(testDir3, "untracked.txt"), "untracked content");

      const { error: error3, code: code3 } = await runCommand([bunExe(), "pm", "version", "patch"], testDir3, false);

      expect(error3).toContain("Git working directory not clean");
      expect(code3).toBe(1);
    });

    it("allows dirty working directory with --force flag", async () => {
      const testDir = setupGitTest();

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
      const testDir5 = setupGitTest();
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
      const testDir6 = setupGitTest();
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
      const testDir7 = setupGitTest();
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
      const testDir8 = setupGitTest();
      const { output: output8, code: code8 } = await runCommand(
        [bunExe(), "pm", "version", "patch", "--message", "Bump version to %s"],
        testDir8,
      );

      expect(code8).toBe(0);
      expect(output8.trim()).toBe("v1.0.1");

      const { output: logOutput8 } = await runCommand(["git", "log", "--oneline", "-1"], testDir8);
      expect(logOutput8).toContain("Bump version to 1.0.1");

      const testDir9 = setupGitTest();
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

      const testDir1 = tempDirWithFiles(`version-${i++}`, {
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
  });

  describe("prerelease handling", () => {
    it("handles custom preid and prerelease scenarios", async () => {
      const testDir1 = tempDirWithFiles(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }, null, 2),
      });

      const { output: output1, code: code1 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--preid", "beta", "--no-git-tag-version"],
        testDir1,
      );

      expect(code1).toBe(0);
      expect(output1.trim()).toBe("v1.0.1-beta.0");

      const testDir3 = tempDirWithFiles(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0" }, null, 2),
      });

      const { output: output3, code: code3 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--no-git-tag-version"],
        testDir3,
      );

      expect(code3).toBe(0);
      expect(output3.trim()).toBe("v1.0.1-0");

      const testDir5 = tempDirWithFiles(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0-alpha" }, null, 2),
      });

      const { output: output5, code: code5 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--no-git-tag-version"],
        testDir5,
      );

      expect(code5).toBe(0);
      expect(output5.trim()).toBe("v1.0.0-alpha.1");

      const testDir6 = tempDirWithFiles(`version-${i++}`, {
        "package.json": JSON.stringify({ name: "test", version: "1.0.0-3" }, null, 2),
      });

      const { output: output6, code: code6 } = await runCommand(
        [bunExe(), "pm", "version", "prerelease", "--no-git-tag-version"],
        testDir6,
      );

      expect(code6).toBe(0);
      expect(output6.trim()).toBe("v1.0.0-4");
    });

    it("should preserve prerelease identifiers correctly", async () => {
      const scenarios = [
        {
          version: "1.0.3-alpha.1",
          preid: "beta",
          expected: {
            patch: "1.0.3-alpha.1 → 1.0.4",
            minor: "1.0.3-alpha.1 → 1.1.0",
            major: "1.0.3-alpha.1 → 2.0.0",
            prerelease: "1.0.3-alpha.1 → 1.0.3-beta.2",
            prepatch: "1.0.3-alpha.1 → 1.0.4-beta.0",
            preminor: "1.0.3-alpha.1 → 1.1.0-beta.0",
            premajor: "1.0.3-alpha.1 → 2.0.0-beta.0",
          },
        },
        {
          version: "1.0.3-1",
          preid: "abcd",
          expected: {
            patch: "1.0.3-1 → 1.0.4",
            minor: "1.0.3-1 → 1.1.0",
            major: "1.0.3-1 → 2.0.0",
            prerelease: "1.0.3-1 → 1.0.3-abcd.2",
            prepatch: "1.0.3-1 → 1.0.4-abcd.0",
            preminor: "1.0.3-1 → 1.1.0-abcd.0",
            premajor: "1.0.3-1 → 2.0.0-abcd.0",
          },
        },
        {
          version: "2.5.0-rc.3",
          preid: "next",
          expected: {
            patch: "2.5.0-rc.3 → 2.5.1",
            minor: "2.5.0-rc.3 → 2.6.0",
            major: "2.5.0-rc.3 → 3.0.0",
            prerelease: "2.5.0-rc.3 → 2.5.0-next.4",
            prepatch: "2.5.0-rc.3 → 2.5.1-next.0",
            preminor: "2.5.0-rc.3 → 2.6.0-next.0",
            premajor: "2.5.0-rc.3 → 3.0.0-next.0",
          },
        },
        {
          version: "1.0.0-a",
          preid: "b",
          expected: {
            patch: "1.0.0-a → 1.0.1",
            minor: "1.0.0-a → 1.1.0",
            major: "1.0.0-a → 2.0.0",
            prerelease: "1.0.0-a → 1.0.0-b.1",
            prepatch: "1.0.0-a → 1.0.1-b.0",
            preminor: "1.0.0-a → 1.1.0-b.0",
            premajor: "1.0.0-a → 2.0.0-b.0",
          },
        },
      ];

      for (const scenario of scenarios) {
        const testDir = tempDirWithFiles(`version-${i++}`, {
          "package.json": JSON.stringify({ name: "test", version: scenario.version }, null, 2),
        });

        const { output, code } = await runCommand(
          [bunExe(), "pm", "version", "--no-git-tag-version", `--preid=${scenario.preid}`],
          testDir,
        );

        expect(code).toBe(0);
        expect(output).toContain(`Current package version: v${scenario.version}`);

        for (const [incrementType, expectedTransformation] of Object.entries(scenario.expected)) {
          expect(output).toContain(`${incrementType.padEnd(10)} ${expectedTransformation}`);
        }
      }

      const testDir2 = tempDirWithFiles(`version-${i++}`, {
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
    it("runs lifecycle scripts in correct order and handles failures", async () => {
      const testDir1 = tempDirWithFiles(`version-${i++}`, {
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

      const testDir2 = tempDirWithFiles(`version-${i++}`, {
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

      expect(Bun.file(join(testDir2, "event.log")).exists()).resolves.toBe(true);
      expect(Bun.file(join(testDir2, "script.log")).exists()).resolves.toBe(true);

      const eventContent = await Bun.file(join(testDir2, "event.log")).text();
      const scriptContent = await Bun.file(join(testDir2, "script.log")).text();

      expect(eventContent.trim()).toBe("preversion");
      expect(scriptContent.trim()).toContain("echo $npm_lifecycle_event");

      const testDir3 = tempDirWithFiles(`version-${i++}`, {
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

      const testDir4 = tempDirWithFiles(`version-${i++}`, {
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

      expect(Bun.file(join(testDir4, "version-output.txt")).exists()).resolves.toBe(true);
      expect(Bun.file(join(testDir4, "build")).exists()).resolves.toBe(false);

      const content = await Bun.file(join(testDir4, "version-output.txt")).text();
      expect(content.trim()).toBe("built");

      const testDir5 = tempDirWithFiles(`version-${i++}`, {
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
      const testDir = tempDirWithFiles(`version-${i++}`, {
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
