import { describe, expect, test } from "bun:test";
import { spawn as cpSpawn } from "child_process";
import { chmodSync, copyFileSync, realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
import path from "path";

test.skipIf(isWindows)("spawn uses PATH from env if present", async () => {
  const tmpDir = await tempDirWithFiles("spawn-path", {
    "test-script": `#!/usr/bin/env bash
echo "hello from script"`,
  });

  chmodSync(path.join(tmpDir, "test-script"), 0o777);

  const proc = Bun.spawn(["test-script"], {
    env: {
      ...bunEnv,
      PATH: tmpDir + ":" + bunEnv.PATH,
    },
  });

  const output = await proc.stdout.text();
  expect(output.trim()).toBe("hello from script");

  const status = await proc.exited;
  expect(status).toBe(0);
});

// What a Windows environment has. bunEnv spells it `PATH`.
test.skipIf(!isWindows)("spawn uses the PATH that env spells `Path`", async () => {
  using dir = tempDir("spawn-path-spelling", { "only-here.cmd": "@echo found\r\n" });
  const { PATH, ...rest } = bunEnv;
  const env = { ...rest, Path: `${String(dir)};${PATH}` };
  const run = async (cmd: string[]) => {
    await using proc = Bun.spawn({ cmd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  };
  const [lookup, child] = await Promise.all([run(["only-here"]), run([bunExe(), "-p", "process.env.PATH"])]);
  expect({ lookup, child }).toEqual({
    lookup: { stdout: "found", stderr: "", exitCode: 0 },
    child: { stdout: env.Path, stderr: "", exitCode: 0 },
  });
});

// Node's execvp walks PATH after the child's chdir, so a relative PATH entry
// like `.` or `node_modules/.bin` refers to the child's cwd, not the parent's.
describe.skipIf(isWindows)("spawn resolves relative PATH entries against the cwd option", () => {
  function makeDir() {
    const dir = tempDir("spawn-relpath", {
      "sub/tool.sh": "#!/bin/sh\necho RAN\n",
      "project/node_modules/.bin/mytool": "#!/bin/sh\necho FROM_BIN\n",
    });
    chmodSync(path.join(String(dir), "sub", "tool.sh"), 0o755);
    chmodSync(path.join(String(dir), "project", "node_modules", ".bin", "mytool"), 0o755);
    return dir;
  }

  test.concurrent("Bun.spawn with PATH='.'", async () => {
    using dir = makeDir();
    await using proc = Bun.spawn({
      cmd: ["tool.sh"],
      cwd: path.join(String(dir), "sub"),
      env: { ...bunEnv, PATH: ".:" + bunEnv.PATH },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("RAN");
    expect(exitCode).toBe(0);
  });

  test.concurrent("Bun.spawn with PATH='node_modules/.bin'", async () => {
    using dir = makeDir();
    await using proc = Bun.spawn({
      cmd: ["mytool"],
      cwd: path.join(String(dir), "project"),
      env: { ...bunEnv, PATH: "node_modules/.bin:" + bunEnv.PATH },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("FROM_BIN");
    expect(exitCode).toBe(0);
  });

  test.concurrent("child_process.spawn with PATH='.'", async () => {
    using dir = makeDir();
    const { promise, resolve, reject } = Promise.withResolvers<{
      stdout: string;
      stderr: string;
      code: number | null;
    }>();
    const c = cpSpawn("tool.sh", [], {
      cwd: path.join(String(dir), "sub"),
      env: { ...bunEnv, PATH: ".:" + bunEnv.PATH },
    });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", d => (stdout += d));
    c.stderr.on("data", d => (stderr += d));
    c.on("error", reject);
    c.on("close", code => resolve({ stdout, stderr, code }));
    const result = await promise;
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("RAN");
    expect(result.code).toBe(0);
  });
});

describe.concurrent.skipIf(!isWindows)("Windows spawn path resolution", () => {
  // A copy of cmd.exe serves as a small executable. It gets a plain argv0 because it parses argv[0] for switches too.
  const comspec = path.join(process.env.SystemRoot ?? "", "System32", "cmd.exe");
  const echoArgs = ["/d", "/c", "echo", "started"];
  function createExecutableDir(executables: string[], files: Record<string, string> = {}) {
    const dir = tempDir("spawn-find", { ...Object.fromEntries(executables.map(name => [name, ""])), ...files });
    for (const name of executables) copyFileSync(comspec, path.join(String(dir), name));
    return dir;
  }
  async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
    try {
      await using proc = Bun.spawn({
        cmd,
        argv0: cmd[1] === echoArgs[0] ? "tool" : undefined,
        cwd: options.cwd,
        env: { ...bunEnv, ...options.env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return exitCode === 0 && stderr === "" ? stdout.trim() : { stdout, stderr, exitCode };
    } catch (error: any) {
      return error.code;
    }
  }

  test.each([
    ["an absolute path with an extension", (dir: string) => `${dir}\\bin\\tool.exe`],
    ["an absolute path without an extension", (dir: string) => `${dir}\\bin\\tool`],
    ["an absolute path with forward slashes", (dir: string) => `${dir.replaceAll("\\", "/")}/bin/tool.exe`],
    [
      "an absolute path with forward slashes and no extension",
      (dir: string) => `${dir.replaceAll("\\", "/")}/bin/tool`,
    ],
    ["an absolute path with different casing", (dir: string) => `${dir.toUpperCase()}/BIN/TOOL.EXE`],
    ["a relative path", () => "bin\\tool.exe"],
    ["a relative path with forward slashes", () => "./bin/tool"],
    ["a relative path containing ..", () => "bin/../bin/tool.exe"],
    ["a root-relative path", (dir: string) => `${dir.slice(2)}\\bin\\tool.exe`],
    ["a root-relative path with forward slashes", (dir: string) => `${dir.slice(2).replaceAll("\\", "/")}/bin/tool`],
    ["a drive-relative path", (dir: string) => `${dir.slice(0, 2)}bin\\tool.exe`],
    ["a drive-relative path with forward slashes", (dir: string) => `${dir.slice(0, 2)}bin/tool`],
    ["an extended-length path", (dir: string) => `\\\\?\\${dir}\\bin\\tool.exe`],
    ["a UNC path", (dir: string) => `\\\\localhost\\${dir[0]}$${dir.slice(2)}\\bin\\tool.exe`],
    [
      "a UNC path with forward slashes",
      (dir: string) => `//localhost/${dir[0]}$${dir.slice(2).replaceAll("\\", "/")}/bin/tool`,
    ],
  ])("resolves %s", async (_, buildPath) => {
    using dir = createExecutableDir(["bin/tool.exe"]);
    expect(await run([buildPath(String(dir)), ...echoArgs], { cwd: String(dir) })).toBe("started");
  });

  test("appends an extension to a name that contains a dot", async () => {
    using dir = createExecutableDir(["bin/tool.v2.exe"]);
    expect(await run(["./bin/tool.v2", ...echoArgs], { cwd: String(dir) })).toBe("started");
    expect(await run(["tool.v2", ...echoArgs], { env: { PATH: `${dir}\\bin` } })).toBe("started");
  });

  test.each(["tool.bin", "tool.cmd", "tool.bat"])("runs an executable image named %j", async name => {
    using dir = createExecutableDir([name]);
    expect(await run([`${dir}\\${name}`, ...echoArgs])).toBe("started");
  });

  test("fails with ENOENT for a file without an extension", async () => {
    using dir = createExecutableDir(["bin/tool"]);
    expect({
      path: await run(["./bin/tool", ...echoArgs], { cwd: String(dir) }),
      PATH: await run(["tool", ...echoArgs], { env: { PATH: `${dir}\\bin` } }),
    }).toEqual({ path: "ENOENT", PATH: "ENOENT" });
  });

  test("does not treat a directory as an executable", async () => {
    using dir = createExecutableDir(["second/tool.exe"], { "first/tool.exe/file": "" });
    expect({
      path: await run(["./first/tool.exe", ...echoArgs], { cwd: String(dir) }),
      PATH: await run(["tool", ...echoArgs], { env: { PATH: `${dir}\\first;${dir}\\second` } }),
    }).toEqual({ path: "ENOENT", PATH: "started" });
  });

  test("fails with EFTYPE for a file that is not an executable", async () => {
    using dir = tempDir("spawn-find", { "empty.exe": "" });
    expect(await run([`${dir}/empty.exe`])).toBe("EFTYPE");
  });

  test.each([
    ["empty entries", (dir: string) => `;;${dir}\\bin;;`],
    ["a trailing separator", (dir: string) => `${dir}\\bin\\`],
    ["forward slashes", (dir: string) => `${dir.replaceAll("\\", "/")}/bin`],
    ["missing and invalid entries", (dir: string) => `Q:\\no;<>|;${dir}\\bin`],
    ["an overlong entry", (dir: string) => `${Buffer.alloc(30000, "a")};${dir}\\bin`],
  ])("searches a PATH with %s", async (_, buildPathEnv) => {
    using dir = createExecutableDir(["bin/tool.exe"]);
    expect(await run(["tool", ...echoArgs], { env: { PATH: buildPathEnv(String(dir)) } })).toBe("started");
  });

  test.each([";", ";.;"])("fails with ENOENT for a missing executable when PATH=%j", async PATH => {
    using dir = tempDir("spawn-find", {});
    expect(await run(["no-such-tool"], { cwd: String(dir), env: { PATH } })).toBe("ENOENT");
  });

  test.each([";.;", ""])("finds an executable in cwd when PATH=%j", async PATH => {
    using dir = createExecutableDir(["tool.exe"]);
    expect(await run(["tool", ...echoArgs], { cwd: String(dir), env: { PATH } })).toBe("started");
  });

  test("searches cwd first, then PATH entries in order", async () => {
    using dir = tempDir("spawn-find", {
      "cwd/one.cmd": "@echo cwd\r\n",
      "a/one.cmd": "@echo a\r\n",
      "a/two.cmd": "@echo a\r\n",
      "b/two.cmd": "@echo b\r\n",
    });
    const options = { cwd: `${dir}\\cwd`, env: { PATH: `${dir}\\a;${dir}\\b` } };
    expect([await run(["one"], options), await run(["two"], options)]).toEqual(["cwd", "a"]);
  });

  describe("batch file", () => {
    const script = "@echo [%~1] [%~2]\r\n@exit /b 0\r\n";
    const dirNames = ["plain", "with space", "bang!", "\u00e9\u4e16"];

    test.each(dirNames)("runs from a directory named %j", async dirName => {
      using dir = tempDir("spawn-batch", { [`${dirName}/tool.cmd`]: script, [`${dirName}/tool.bat`]: script });
      expect([
        await run([`${dir}\\${dirName}\\tool.cmd`, "a", "b"]),
        await run([`${dir}\\${dirName}\\tool.bat`, "a", "b"]),
      ]).toEqual(["[a] [b]", "[a] [b]"]);
    });

    test("receives empty arguments and arguments with spaces", async () => {
      using dir = tempDir("spawn-batch", { "tool.cmd": script });
      expect([await run([`${dir}\\tool.cmd`, "a b", "c"]), await run([`${dir}\\tool.cmd`, "", "c"])]).toEqual([
        "[a b] [c]",
        "[] [c]",
      ]);
    });

    test("receives non-ASCII words like ASCII words", async () => {
      using dir = tempDir("spawn-batch", { "tool.cmd": "@if [%1]==[%~1] echo bare\r\n" });
      expect([await run([`${dir}\\tool.cmd`, "e"]), await run([`${dir}\\tool.cmd`, "\u00e9\u4e16"])]).toEqual([
        "bare",
        "bare",
      ]);
    });

    test.each([...dirNames, "(parens)", "com,ma", "e=q", "x (86)"])(
      "is found through a PATH entry named %j",
      async dirName => {
        using dir = tempDir("spawn-batch", { [`${dirName}/tool.cmd`]: script });
        expect(await run(["tool", "a b", "c"], { env: { PATH: `${dir}\\${dirName}` } })).toBe("[a b] [c]");
      },
    );

    test("runs from a path with forward slashes", async () => {
      using dir = tempDir("spawn-batch", { "bin/tool.cmd": script });
      expect([
        await run([`${String(dir).replaceAll("\\", "/")}/bin/tool.cmd`, "a", "b"]),
        await run(["./bin/tool.cmd", "a", "b"], { cwd: String(dir) }),
      ]).toEqual(["[a] [b]", "[a] [b]"]);
    });

    test("reports its exit code", async () => {
      using dir = tempDir("spawn-batch", { "tool.cmd": "@exit /b 200\r\n" });
      expect(await run([`${dir}\\tool.cmd`])).toEqual({ stdout: "", stderr: "", exitCode: 200 });
    });
  });

  describe("cwd", () => {
    const printCwdCmd = [bunExe(), "-p", "process.cwd()"];
    test.each([
      ["a trailing separator", (dir: string) => `${dir}\\sub\\`],
      ["forward slashes", (dir: string) => `${dir.replaceAll("\\", "/")}/sub`],
      [". and .. segments", (dir: string) => `${dir}\\.\\sub\\..\\sub`],
      ["a relative path", (dir: string) => path.relative(process.cwd(), `${dir}\\sub`)],
      ["a root-relative path", (dir: string) => `${dir.slice(2)}\\sub`],
    ])("accepts %s", async (name, buildCwd) => {
      using dir = tempDir("spawn-cwd", { "sub/file": "" });
      const isSameDrive = String(dir)[0].toUpperCase() === process.cwd()[0].toUpperCase();
      const cwd = name === "a root-relative path" && !isSameDrive ? `${dir}\\sub` : buildCwd(String(dir));
      expect(realpathSync.native(await run(printCwdCmd, { cwd }))).toBe(realpathSync.native(`${dir}\\sub`));
    });

    test("accepts a drive root", async () => {
      const root = path.parse(process.cwd()).root;
      expect(await run(printCwdCmd, { cwd: root })).toBe(root);
    });

    test("accepts a UNC path", async () => {
      using dir = tempDir("spawn-cwd", { "sub/file": "here" });
      const cwd = `\\\\localhost\\${String(dir)[0]}$${String(dir).slice(2)}\\sub`;
      expect(await run([bunExe(), "-p", "require('fs').readFileSync('file', 'utf8')"], { cwd })).toBe("here");
    });

    test("accepts non-BMP characters", async () => {
      using dir = tempDir("spawn-cwd", { "\u{1F600} \u00e9/file": "here" });
      const cwd = `${dir}\\\u{1F600} \u00e9`;
      expect(await run([bunExe(), "-p", "path.basename(process.cwd())"], { cwd })).toBe("\u{1F600} \u00e9");
    });

    test("fails with ENOENT when missing or not a directory", async () => {
      using dir = tempDir("spawn-cwd", { file: "" });
      expect([
        await run(printCwdCmd, { cwd: `${dir}\\missing` }),
        await run(printCwdCmd, { cwd: `${dir}\\file` }),
      ]).toEqual(["ENOENT", "ENOENT"]);
    });
  });
});
