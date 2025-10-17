import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles, toTOMLString } from "harness";
import { join as pathJoin } from "node:path";

describe.each(["bun run", "bun"])(`%s`, cmd => {
  const runCmd = cmd === "bun" ? ["-c=bunfig.toml", "run"] : ["-c=bunfig.toml"];
  const node = Bun.which("node")!;
  const execPath = process.execPath;

  describe.each(["--bun", "without --bun"])("%s", cmd2 => {
    test("which node", async () => {
      const bun = cmd2 === "--bun";
      const bunFlag = bun ? ["--bun"] : [];
      const bunfig = toTOMLString({
        run: {
          bun,
        },
      });

      const cwd = tempDirWithFiles("run.where.node", {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              "where-node": `which node`,
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), "--silent", ...bunFlag, ...runCmd, "where-node"],
        env: bunEnv,
        stderr: "inherit",
        stdout: "pipe",
        stdin: "ignore",
        cwd,
      });
      const nodeBin = result.stdout.toString().trim();

      if (bun) {
        if (isWindows) {
          expect(realpathSync(nodeBin)).toContain("\\bun-node-");
        } else {
          expect(realpathSync(nodeBin)).toBe(realpathSync(execPath));
        }
      } else {
        expect(realpathSync(nodeBin)).toBe(realpathSync(node));
      }
      expect(result.success).toBeTrue();
    });
  });

  describe.each(["bun", "system", "default"])(`run.shell = "%s"`, shellStr => {
    if (isWindows && shellStr === "system") return; // windows always uses the bun shell now
    const shell = shellStr === "default" ? (isWindows ? "bun" : "system") : shellStr;
    const command_not_found =
      isWindows && shell === "system" ? "is not recognized as an internal or external command" : "command not found";
    test.each(["true", "false"])('run.silent = "%s"', silentStr => {
      const silent = silentStr === "true";
      const bunfig = toTOMLString({
        run: {
          shell: shellStr === "default" ? undefined : shell,
          silent,
        },
      });

      const cwd = tempDirWithFiles(Bun.hash(bunfig).toString(36), {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              startScript: "echo 1",
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), ...runCmd, "startScript"],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
        stdin: "ignore",
        cwd,
      });

      if (silent) {
        expect(result.stderr.toString().trim()).toBe("");
      } else {
        expect(result.stderr.toString().trim()).toContain("$ echo 1");
      }
      expect(result.success).toBeTrue();
    });
    test("command not found", async () => {
      const bunfig = toTOMLString({
        run: {
          shell,
        },
      });

      const cwd = tempDirWithFiles("run.shell.system-" + Bun.hash(bunfig).toString(32), {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              start: "this-should-start-with-bun-in-the-error-message",
            },
          },
          null,
          2,
        ),
      });

      const result = Bun.spawnSync({
        cmd: [bunExe(), "--silent", ...runCmd, "start"],
        env: bunEnv,
        stderr: "pipe",
        stdout: "inherit",
        stdin: "ignore",
        cwd,
      });

      const err = result.stderr.toString().trim();
      expect(err).toContain(command_not_found);
      expect(err).toContain("this-should-start-with-bun-in-the-error-message");
      expect(result.success).toBeFalse();
    });
  });

  test("autoload local bunfig.toml (same cwd)", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    const cwd = tempDirWithFiles("run.where.node", {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd,
    });
    const nodeBin = result.stdout.toString().trim();

    if (isWindows) {
      expect(realpathSync(nodeBin)).toContain("\\bun-node-");
    } else {
      expect(realpathSync(nodeBin)).toBe(realpathSync(execPath));
    }
  });

  test("NOT autoload local bunfig.toml (sub cwd)", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    const cwd = tempDirWithFiles("run.where.node", {
      "bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
      "subdir/a.txt": "a",
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd: pathJoin(cwd, "./subdir"),
    });
    const nodeBin = result.stdout.toString().trim();

    expect(realpathSync(nodeBin)).toBe(realpathSync(node));
    expect(result.success).toBeTrue();
  });

  test("NOT autoload home bunfig.toml", async () => {
    const runCmd = cmd === "bun" ? ["run"] : [];

    const bunfig = toTOMLString({
      run: {
        bun: true,
      },
    });

    const cwd = tempDirWithFiles("run.where.node", {
      "my-home/.bunfig.toml": bunfig,
      "package.json": JSON.stringify(
        {
          scripts: {
            "where-node": `which node`,
          },
        },
        null,
        2,
      ),
    });

    const result = Bun.spawnSync({
      cmd: [bunExe(), "--silent", ...runCmd, "where-node"],
      env: {
        ...bunEnv,
        HOME: pathJoin(cwd, "./my-home"),
      },
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      cwd,
    });
    const nodeBin = result.stdout.toString().trim();

    expect(realpathSync(nodeBin)).toBe(realpathSync(node));
    expect(result.success).toBeTrue();
  });
});
