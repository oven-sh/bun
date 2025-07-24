import { test, expect, describe, beforeAll, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "fs";

// if BUN_DEBUG_QUIET_LOGS is set, we'll wait longer for tests to complete
if (process.env.BUN_DEBUG_QUIET_LOGS) {
  setDefaultTimeout(100000);
}

describe("bun node", () => {
  let sharedDir: string;
  let sharedEnv: any;
  let sharedBinDir: string;

  beforeAll(() => {
    const testDir = tempDirWithFiles("node-test-shared", {});
    const bunInstallDir = join(testDir, ".bun");
    const binDir = join(bunInstallDir, "bin");
    mkdirSync(binDir, { recursive: true });

    sharedDir = testDir;
    sharedBinDir = binDir;
    sharedEnv = {
      ...bunEnv,
      BUN_INSTALL: bunInstallDir,
      BUN_INSTALL_BIN: binDir,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      HOME: testDir,
    };
  });

  test("shows help when no arguments", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "node"],
      env: bunEnv,
      stdout: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(output).toInclude("Examples:");
    expect(output).toInclude("$ bun node lts");
    expect(output).toInclude("$ bun node bun");
  });

  describe("version management", () => {
    test("installs and runs Node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "24"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(stdout).toInclude("Successfully installed Node.js v24");

      writeFileSync(join(sharedDir, "test.js"), "console.log(process.version);");

      await using runProc = Bun.spawn({
        cmd: [bunExe(), "node", "test.js"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
      });

      const runOutput = await new Response(runProc.stdout).text();
      expect(await runProc.exited).toBe(0);
      expect(runOutput).toMatch(/v24\.\d+\.\d+/);
    });

    test("handles already installed version", async () => {
      await using _ = Bun.spawn({
        cmd: [bunExe(), "node", "24"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "24"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(output).toMatch(/Set Node\.js v\d+\.\d+\.\d+ as default/);
    });
  });

  describe("script execution", () => {
    test("runs scripts with arguments", async () => {
      writeFileSync(join(sharedDir, "args.js"), `console.log('Args:', process.argv.slice(2).join(' '));`);

      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "args.js", "arg1", "arg2", "--flag"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(stdout).toInclude("Args: arg1 arg2 --flag");
    });

    test("runs with specific version", async () => {
      writeFileSync(join(sharedDir, "version.js"), "console.log(process.version);");

      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "24", "version.js"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(stdout).toMatch(/v24\.\d+\.\d+/);
    });

    test("handles node flags", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "--print", "'hello'"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(stdout.trim()).toBe("hello");
    });
  });

  describe("bun alias", () => {
    test("creates node -> bun alias", async () => {
      const testEnv = (() => {
        const testDir = tempDirWithFiles("node-alias", {});
        const bunInstallDir = join(testDir, ".bun");
        const binDir = join(bunInstallDir, "bin");
        mkdirSync(binDir, { recursive: true });

        return {
          dir: testDir,
          env: {
            ...bunEnv,
            BUN_INSTALL: bunInstallDir,
            BUN_INSTALL_BIN: binDir,
            PATH: `${binDir}:${process.env.PATH || ""}`,
            HOME: testDir,
          },
          binDir,
        };
      })();

      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "bun"],
        env: testEnv.env,
        stdout: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      expect(stdout).toInclude("Successfully aliased 'node' to Bun");

      const nodePath = join(testEnv.binDir, process.platform === "win32" ? "node.exe" : "node");
      expect(existsSync(nodePath)).toBe(true);

      await using runProc = Bun.spawn({
        cmd: ["node", "--print", "process.versions.bun"],
        env: testEnv.env,
        cwd: testEnv.dir,
        stdout: "pipe",
      });
      const runOutput = await new Response(runProc.stdout).text();
      expect(runOutput.trim()).toBe(Bun.version);
    });
  });

  describe("PATH warnings", () => {
    test("warns when bun bin dir comes after another node", async () => {
      const testEnv = (() => {
        const testDir = tempDirWithFiles("node-path-warn", {});
        const bunInstallDir = join(testDir, ".bun");
        const binDir = join(bunInstallDir, "bin");
        const otherDir = join(testDir, "other-bin");

        mkdirSync(binDir, { recursive: true });
        mkdirSync(otherDir);

        if (process.platform !== "win32") {
          writeFileSync(join(otherDir, "node"), "#!/bin/bash\necho 'other node'");
          chmodSync(join(otherDir, "node"), 0o755);
        } else {
          writeFileSync(join(otherDir, "node.cmd"), "@echo off\necho 'other node'");
        }

        return {
          dir: testDir,
          env: {
            ...bunEnv,
            BUN_INSTALL: bunInstallDir,
            BUN_INSTALL_BIN: binDir,
            PATH: `${otherDir}:${binDir}:${process.env.PATH || ""}`,
            HOME: testDir,
          },
        };
      })();

      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "24"],
        env: testEnv.env,
        cwd: testEnv.dir,
        stdout: "pipe",
      });
      await proc.exited;

      const output = await new Response(proc.stdout).text();
      if (process.platform !== "win32") {
        expect(output).toInclude("Warning:");
        expect(output).toInclude("appears after another 'node' in PATH");
      }
    });
  });

  describe("error handling", () => {
    test("handles invalid version", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "99"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(1);
      expect(stderr).toInclude("error");
    });

    test("handles missing script file", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "nonexistent.js"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).not.toBe(0);
      expect(stderr).toInclude("Cannot find module");
    });
  });

  describe("environment variables", () => {
    test("respects BUN_INSTALL_BIN", async () => {
      const customBin = join(sharedDir, "custom-bin");
      mkdirSync(customBin);

      const env = {
        ...sharedEnv,
        BUN_INSTALL_BIN: customBin,
        PATH: `${customBin}:${process.env.PATH || ""}`,
      };

      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "bun"],
        env,
        cwd: sharedDir,
        stdout: "pipe",
      });

      expect(await proc.exited).toBe(0);

      const binaryName = process.platform === "win32" ? "node.exe" : "node";
      const nodePath = join(customBin, binaryName);
      expect(existsSync(nodePath)).toBe(true);
    });

    test("prepends bin dir to PATH for child process", async () => {
      writeFileSync(
        join(sharedDir, "check-path.js"),
        `
        const path = process.env.PATH || '';
        const binDir = '${sharedBinDir}';
        console.log(path.startsWith(binDir) ? 'PATH correct' : 'PATH wrong');
        `,
      );

      await using proc = Bun.spawn({
        cmd: [bunExe(), "node", "check-path.js"],
        env: sharedEnv,
        cwd: sharedDir,
        stdout: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      expect(stdout).toInclude("PATH correct");
    });
  });

  test("downloads silently when running scripts", async () => {
    const testEnv = (() => {
      const testDir = tempDirWithFiles("node-silent-dl", {});
      const bunInstallDir = join(testDir, ".bun");
      const binDir = join(bunInstallDir, "bin");
      mkdirSync(binDir, { recursive: true });

      return {
        dir: testDir,
        env: {
          ...bunEnv,
          BUN_INSTALL: bunInstallDir,
          BUN_INSTALL_BIN: binDir,
          PATH: `${binDir}:${process.env.PATH || ""}`,
          HOME: testDir,
        },
      };
    })();

    writeFileSync(join(testEnv.dir, "output.js"), "console.log('OUTPUT');");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "node", "21", "output.js"],
      env: testEnv.env,
      cwd: testEnv.dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    expect(stdout.trim()).toBe("OUTPUT");
    expect(stderr).not.toInclude("Downloading");
    expect(stderr).not.toInclude("Successfully");
  });
});
