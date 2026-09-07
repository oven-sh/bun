import { describe, expect, test } from "bun:test";
import { copyFileSync, linkSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, unlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, toTOMLString } from "harness";
import { dirname, join as pathJoin } from "node:path";

// Windows uses hardlinks; POSIX aliases have different replacement semantics.
describe.skipIf(!isWindows).each(["bunfig", "--bun"])("Windows node aliases (%s)", mode => {
  function fixture() {
    return tempDir("bun runtime 路径", {
      "package.json": JSON.stringify({
        scripts: {
          probe: "which node; echo $NODE; echo $npm_node_execpath",
          child: "node probe.js",
          nested: "bun --silent --bun run probe",
        },
      }),
      "bunfig.toml": mode === "bunfig" ? "[run]\nbun = true\n" : "",
      "cache/.keep": "",
      "probe.js": `console.log(JSON.stringify({
        executable: process.execPath, version: Bun.version,
        node: process.env.NODE, nodeExecPath: process.env.npm_node_execpath,
      }));`,
    });
  }

  function install(cwd: string, name: string, newInode = false) {
    const executable = pathJoin(cwd, name);
    if (newInode) copyFileSync(bunExe(), executable);
    else linkSync(bunExe(), executable);
    return executable;
  }

  async function run(cwd: string, executable: string, script = "probe") {
    await using proc = Bun.spawn({
      cmd: [executable, "--silent", ...(mode === "--bun" ? ["--bun"] : []), "run", script],
      cwd,
      env: { ...bunEnv, TEMP: pathJoin(cwd, "cache"), TMP: pathJoin(cwd, "cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  async function probe(cwd: string, executable: string, script = "probe") {
    const { stdout, stderr, exitCode } = await run(cwd, executable, script);
    expect(stderr).toBe("");
    let node: string;
    if (script === "child") {
      const output = JSON.parse(stdout);
      expect(output).toEqual({
        executable: expect.any(String),
        version: Bun.version,
        node: output.executable,
        nodeExecPath: output.executable,
      });
      node = output.executable;
    } else {
      const lines = stdout.trim().split(/\r?\n/);
      node = lines[0];
      expect(lines).toEqual([node, node, node]);
    }
    expect(exitCode).toBe(0);
    expect(dirname(dirname(node))).toBe(realpathSync(pathJoin(cwd, "cache")));
    const source = statSync(executable, { bigint: true });
    for (const path of [node, pathJoin(dirname(node), "bun.exe")]) {
      const alias = statSync(path, { bigint: true });
      expect({ dev: alias.dev, ino: alias.ino }).toEqual({ dev: source.dev, ino: source.ino });
    }
    return node;
  }

  test.concurrent.each(["same", "different"])("concurrent callers from %s installations", async installation => {
    using cwd = fixture();
    const first = install(cwd, "first.exe");
    const second = installation === "same" ? first : install(cwd, "second.exe", true);
    const aliases = await Promise.all([probe(cwd, first), probe(cwd, second)]);
    if (installation === "same") expect(aliases[0]).toBe(aliases[1]);
    else expect(aliases[0]).not.toBe(aliases[1]);
    for (const alias of aliases) {
      expect(readdirSync(dirname(alias)).sort()).toEqual(["bun.exe", "node.exe"]);
    }
  });

  test.concurrent("refreshes aliases at the same path after replacing the installation", async () => {
    using cwd = fixture();
    const first = install(cwd, "first.exe");
    const alias = await probe(cwd, first);
    const old = statSync(first, { bigint: true });
    renameSync(install(cwd, "replacement.exe", true), first);
    expect(statSync(first, { bigint: true }).ino).not.toBe(old.ino);
    expect(await probe(cwd, first)).toBe(alias);
    expect(readdirSync(dirname(alias)).sort()).toEqual(["bun.exe", "node.exe"]);
  });

  test.concurrent("repairs stale aliases before a nested invocation", async () => {
    using cwd = fixture();
    const first = install(cwd, "first.exe");
    const second = install(cwd, "second.exe", true);
    const node = await probe(cwd, first);
    for (const alias of [node, pathJoin(dirname(node), "bun.exe")]) {
      unlinkSync(alias);
      linkSync(second, alias);
    }
    expect(await probe(cwd, first, "nested")).toBe(node);
  });

  test.concurrent("child runtime and npm environment agree", async () => {
    using cwd = fixture();
    await probe(cwd, install(cwd, "first.exe"), "child");
  });

  test.concurrent("rejects an alias directory replaced with a junction", async () => {
    using cwd = fixture();
    const first = install(cwd, "first.exe");
    const node = await probe(cwd, first);
    const redirected = pathJoin(cwd, "redirected");
    renameSync(dirname(node), redirected);
    symlinkSync(redirected, dirname(node), "junction");
    const { stdout, stderr, exitCode } = await run(cwd, first);
    expect(stdout).toBe("");
    expect(stderr).toContain("NotDir");
    expect(exitCode).not.toBe(0);
    expect(readdirSync(redirected).sort()).toEqual(["bun.exe", "node.exe"]);
  });

  if (mode === "bunfig") {
    test.concurrent("fails closed while an old alias is mapped, then retries after it exits", async () => {
      using cwd = fixture();
      const first = install(cwd, "first.exe", true);
      const node = await probe(cwd, first);
      await using running = Bun.spawn({
        cmd: [node, "-e", 'console.log("ready"); await Bun.stdin.text(); console.log("done");'],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const reader = running.stdout.getReader();
      let output = "";
      while (!output.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        output += Buffer.from(value).toString();
      }
      expect(output).toBe("ready\n");
      renameSync(install(cwd, "replacement.exe", true), first);
      try {
        const { stdout, stderr, exitCode } = await run(cwd, first);
        expect(stdout).toBe("");
        expect(stderr).toContain("EPERM");
        expect(exitCode).not.toBe(0);
      } finally {
        running.stdin.end();
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        output += Buffer.from(value).toString();
      }
      expect(output).toBe("ready\ndone\n");
      expect(await running.stderr.text()).toBe("");
      expect(await running.exited).toBe(0);
      expect(await probe(cwd, first)).toBe(node);
      expect(readdirSync(dirname(node)).sort()).toEqual(["bun.exe", "node.exe"]);
    });
  }
});

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

      await using cwd = tempDir("run.where.node", {
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

      using cwd = tempDir(Bun.hash(bunfig).toString(36), {
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

      await using cwd = tempDir("run.shell.system-" + Bun.hash(bunfig).toString(32), {
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

    await using cwd = tempDir("run.where.node", {
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

    await using cwd = tempDir("run.where.node", {
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

    await using cwd = tempDir("run.where.node", {
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
