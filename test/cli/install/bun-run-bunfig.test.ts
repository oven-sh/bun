import { dlopen, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { bunEnv, bunExe, isWindows, mergeWindowEnvs, tempDir, toTOMLString } from "harness";
import { basename, dirname, join as pathJoin } from "node:path";

const otherVolume = (() => {
  if (!isWindows) return;
  const kernel = dlopen("kernel32.dll", {
    GetDriveTypeW: { args: ["ptr"], returns: "u32" },
  });
  using closeKernel = { [Symbol.dispose]: () => kernel.close() };
  const source = statSync(bunExe(), { bigint: true });
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = `${letter}:\\`;
    const wide = Buffer.from(root + "\0", "utf16le");
    // Only fixed disks: disconnected network drives and removable media can block.
    if (kernel.symbols.GetDriveTypeW(ptr(wide)) === 3 && statSync(root, { bigint: true }).dev !== source.dev) {
      return root;
    }
  }
})();

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

  // Hardlinks cannot span volumes; single-volume Windows hosts cannot exercise this fallback.
  test.skipIf(!otherVolume).concurrent("preserves PATH when TEMP is on another volume", async () => {
    using cwd = tempDir("bun-cross-volume", {
      "package.json": JSON.stringify({ scripts: { probe: "which node; echo $PATH" } }),
      "bunfig.toml": mode === "bunfig" ? "[run]\nbun = true\n" : "",
    });
    const cache = pathJoin(otherVolume!, basename(cwd));
    mkdirSync(cache);
    using cleanup = { [Symbol.dispose]: () => rmSync(cache, { recursive: true, force: true }) };
    expect(statSync(cache, { bigint: true }).dev).not.toBe(statSync(bunExe(), { bigint: true }).dev);
    const node = install(cwd, "node.exe");
    expect(() => linkSync(node, pathJoin(cache, "cross-volume.exe"))).toThrow(
      expect.objectContaining({ code: "EXDEV" }),
    );
    const path = String(cwd);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--silent", ...(mode === "--bun" ? ["--bun"] : []), "run", "probe"],
      cwd,
      env: mergeWindowEnvs([bunEnv, { PATH: path, TEMP: cache, TMP: cache }]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expectedPath = [pathJoin(cwd, "node_modules", ".bin")];
    let remain = String(cwd);
    while (remain.includes("\\")) {
      expectedPath.push(pathJoin(remain, "node_modules", ".bin"));
      remain = remain.slice(0, remain.lastIndexOf("\\"));
    }
    expectedPath.push(`${remain}\\node_modules\\.bin`, path);
    expect({ stdout: stdout.trim().split(/\r?\n/), stderr, exitCode }).toEqual({
      stdout: [node, expectedPath.join(";")],
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("runs from an installation path containing an unpaired surrogate", async () => {
    const kernel = dlopen("kernel32.dll", {
      CreateHardLinkW: { args: ["ptr", "ptr", "ptr"], returns: "i32" },
      CreateProcessW: {
        args: ["ptr", "ptr", "ptr", "ptr", "i32", "u32", "ptr", "ptr", "ptr", "ptr"],
        returns: "i32",
      },
      WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
      GetExitCodeProcess: { args: ["u64", "ptr"], returns: "i32" },
      TerminateProcess: { args: ["u64", "u32"], returns: "i32" },
      CloseHandle: { args: ["u64"], returns: "i32" },
      DeleteFileW: { args: ["ptr"], returns: "i32" },
    });
    using closeKernel = { [Symbol.dispose]: () => kernel.close() };
    using cwd = tempDir("bun-surrogate-path", {
      "package.json": JSON.stringify({ scripts: { probe: "node probe.js" } }),
      "bunfig.toml": mode === "bunfig" ? "[run]\nbun = true\n" : "",
      "probe.js": 'require("fs").writeFileSync("result.txt", "OK");',
      "cache/.keep": "",
    });
    const wide = (value: string) => Buffer.from(value + "\0", "utf16le");
    const executable = wide(pathJoin(cwd, "bun-\uD800.exe"));
    const source = wide(bunExe());
    const command = wide(`"${pathJoin(cwd, "bun-\uD800.exe")}" --silent ${mode === "--bun" ? "--bun " : ""}run probe`);
    const directory = wide(String(cwd));
    const environment = wide(
      Object.entries({ ...bunEnv, TEMP: pathJoin(cwd, "cache"), TMP: pathJoin(cwd, "cache") })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${value}\0`)
        .join(""),
    );
    const startup = Buffer.alloc(104);
    startup.writeUInt32LE(startup.length);
    const info = Buffer.alloc(24);
    const k = kernel.symbols;
    expect(k.CreateHardLinkW(ptr(executable), ptr(source), null)).toBe(1);
    let processHandle = 0n;
    let threadHandle = 0n;
    try {
      expect(
        k.CreateProcessW(
          null,
          ptr(command),
          null,
          null,
          0,
          0x400,
          ptr(environment),
          ptr(directory),
          ptr(startup),
          ptr(info),
        ),
      ).toBe(1);
      processHandle = info.readBigUInt64LE(0);
      threadHandle = info.readBigUInt64LE(8);
      expect(k.WaitForSingleObject(processHandle, 30000)).toBe(0);
      const exitCode = Buffer.alloc(4);
      expect(k.GetExitCodeProcess(processHandle, ptr(exitCode))).toBe(1);
      expect(await Bun.file(pathJoin(cwd, "result.txt")).text()).toBe("OK");
      expect(exitCode.readUInt32LE()).toBe(0);
    } finally {
      if (processHandle) {
        k.TerminateProcess(processHandle, 1);
        k.WaitForSingleObject(processHandle, 30000);
        k.CloseHandle(processHandle);
        k.CloseHandle(threadHandle);
      }
      expect(k.DeleteFileW(ptr(executable))).toBe(1);
    }
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
