import { describe, expect, test } from "bun:test";
import { chmodSync, realpathSync } from "fs";
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

// Issue #7703: `bun <file>` / `bun -e` boots the VM through a fast path that
// used to skip the bun-node shim dir, so a child with a `#!/usr/bin/env node`
// shebang could not find `node` even though `bun run <script>` could.
describe("node shim for file entry points", () => {
  const execPath = process.execPath;
  const whereNode = `
    const node = Bun.which("node");
    if (!node) throw new Error("node not on PATH");
    console.log(require("fs").realpathSync(node));
  `;

  for (const [label, argv] of [
    ["bun <file>", ["./where-node.js"]],
    ["bun run ./<file>", ["run", "./where-node.js"]],
    ["bun -e", ["-e", whereNode]],
  ] as const) {
    test.concurrent(`--bun adds the node shim for \`${label}\``, async () => {
      const cwd = tempDirWithFiles("run.bun.file", { "where-node.js": whereNode });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--bun", ...argv],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        cwd,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr.trim()).toBe("");
      if (isWindows) {
        expect(stdout.trim()).toContain("\\bun-node-");
      } else {
        expect(stdout.trim()).toBe(realpathSync(execPath));
      }
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("bunfig [run] bun=true adds the node shim for `bun <file>`", async () => {
    const cwd = tempDirWithFiles("run.bun.file", {
      "bunfig.toml": toTOMLString({ run: { bun: true } }),
      "where-node.js": whereNode,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-c=bunfig.toml", "./where-node.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.trim()).toBe("");
    if (isWindows) {
      expect(stdout.trim()).toContain("\\bun-node-");
    } else {
      expect(stdout.trim()).toBe(realpathSync(execPath));
    }
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(isWindows)(
    "spawning a bin with a node shebang works without node on PATH",
    async () => {
      const cwd = tempDirWithFiles("run.bun.shebang", {
        "bin/my-cli": `#!/usr/bin/env node\nprocess.stdout.write("ran under " + process.argv0);\n`,
        "index.js": `
        const result = Bun.spawnSync({ cmd: ["my-cli"], stdout: "pipe", stderr: "pipe" });
        process.stdout.write(result.stdout.toString());
        process.stderr.write(result.stderr.toString());
        process.exit(result.exitCode);
      `,
      });
      chmodSync(pathJoin(cwd, "bin", "my-cli"), 0o755);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: { ...bunEnv, PATH: pathJoin(cwd, "bin") },
        stdout: "pipe",
        stderr: "pipe",
        cwd,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ran under node");
      expect(exitCode).toBe(0);
    },
  );
});
