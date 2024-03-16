import { describe, expect, test } from "bun:test";
import { realpathSync, chmodSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithFiles, toTOMLString } from "harness";
import { join } from "path";

describe.each(["bun run", "bun"])(`%s`, cmd => {
  const runCmd = cmd === "bun" ? ["run"] : [];
  const node = Bun.which("node")!;

  describe.each(["--bun", "without --bun"])("%s", cmd2 => {
    test("which node", async () => {
      const bun = cmd2 === "--bun";
      const bunFlag = bun ? ["--bun"] : [];
      const bunfig = toTOMLString({
        run: {
          bun,
        },
      });
      const which = isWindows ? "where" : "which";

      const cwd = tempDirWithFiles("run.where.node." + cmd2, {
        "bunfig.toml": bunfig,
        "package.json": JSON.stringify(
          {
            scripts: {
              "where-node": `${which} node`,
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
        expect(realpathSync(nodeBin)).toBe(realpathSync(process.execPath));
      } else {
        expect(realpathSync(nodeBin)).toBe(realpathSync(node));
      }
      expect(result.success).toBeTrue();
    });
  });

  test("run.shell system", async () => {
    const bunfig = toTOMLString({
      run: {
        shell: "system",
      },
    });

    const cwd = tempDirWithFiles("run.shell.system", {
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

    expect(result.success).toBeFalse();
    const err = result.stderr.toString().trim();
    expect(err).not.toStartWith("bun: ");
    expect(err).toContain("command not found");
  });

  test("run.shell bun", async () => {
    const bunfig = toTOMLString({
      run: {
        shell: "bun",
      },
    });

    const cwd = tempDirWithFiles("run.shell.bun", {
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
    expect(err).not.toStartWith("bun: ");
    expect(err).toContain("command not found");
    expect(result.success).toBeFalse();
  });
});
