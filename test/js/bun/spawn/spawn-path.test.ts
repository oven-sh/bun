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

describe.concurrent.skipIf(!isWindows)("how Windows finds the program", () => {
  // A copy of cmd.exe is a small program. It gets a plain argv0, as it looks for its switches in there too.
  const comspec = path.join(process.env.SystemRoot ?? "", "System32", "cmd.exe");
  const sayStarted = ["/d", "/c", "echo", "started"];
  function tree(programs: string[], files: Record<string, string> = {}) {
    const dir = tempDir("spawn-find", { ...Object.fromEntries(programs.map(name => [name, ""])), ...files });
    for (const name of programs) copyFileSync(comspec, path.join(String(dir), name));
    return dir;
  }
  async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
    try {
      await using proc = Bun.spawn({
        cmd,
        argv0: cmd[1] === sayStarted[0] ? "tool" : undefined,
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
    ["with an extension", (dir: string) => `${dir}\\bin\\tool.exe`],
    ["without an extension", (dir: string) => `${dir}\\bin\\tool`],
    ["with forward slashes", (dir: string) => `${dir.replaceAll("\\", "/")}/bin/tool.exe`],
    ["with forward slashes, without an extension", (dir: string) => `${dir.replaceAll("\\", "/")}/bin/tool`],
    ["in another case", (dir: string) => `${dir.toUpperCase()}/BIN/TOOL.EXE`],
    ["relative to cwd", () => "bin\\tool.exe"],
    ["relative to cwd, with forward slashes", () => "./bin/tool"],
    ["through ..", () => "bin/../bin/tool.exe"],
    ["from the root of cwd's drive", (dir: string) => `${dir.slice(2)}\\bin\\tool.exe`],
    [
      "from the root of cwd's drive, with forward slashes",
      (dir: string) => `${dir.slice(2).replaceAll("\\", "/")}/bin/tool`,
    ],
    ["relative to the drive", (dir: string) => `${dir.slice(0, 2)}bin\\tool.exe`],
    ["relative to the drive, with forward slashes", (dir: string) => `${dir.slice(0, 2)}bin/tool`],
    ["as a long path", (dir: string) => `\\\\?\\${dir}\\bin\\tool.exe`],
    ["through a share", (dir: string) => `\\\\localhost\\${dir[0]}$${dir.slice(2)}\\bin\\tool.exe`],
    [
      "through a share, with forward slashes",
      (dir: string) => `//localhost/${dir[0]}$${dir.slice(2).replaceAll("\\", "/")}/bin/tool`,
    ],
  ])("a path %s", async (_, file) => {
    using dir = tree(["bin/tool.exe"]);
    expect(await run([file(String(dir)), ...sayStarted], { cwd: String(dir) })).toBe("started");
  });

  test("a name with a dot in it still gets an extension", async () => {
    using dir = tree(["bin/tool.v2.exe"]);
    expect(await run(["./bin/tool.v2", ...sayStarted], { cwd: String(dir) })).toBe("started");
    expect(await run(["tool.v2", ...sayStarted], { env: { PATH: `${dir}\\bin` } })).toBe("started");
  });

  test.each(["tool.bin", "tool.cmd", "tool.bat"])("an executable runs under the name %j", async name => {
    using dir = tree([name]);
    expect(await run([`${dir}\\${name}`, ...sayStarted])).toBe("started");
  });

  test("a file without an extension is not a program", async () => {
    using dir = tree(["bin/tool"]);
    expect({
      path: await run(["./bin/tool", ...sayStarted], { cwd: String(dir) }),
      PATH: await run(["tool", ...sayStarted], { env: { PATH: `${dir}\\bin` } }),
    }).toEqual({ path: "ENOENT", PATH: "ENOENT" });
  });

  test("a directory is not a program", async () => {
    using dir = tree(["second/tool.exe"], { "first/tool.exe/file": "" });
    expect({
      path: await run(["./first/tool.exe", ...sayStarted], { cwd: String(dir) }),
      PATH: await run(["tool", ...sayStarted], { env: { PATH: `${dir}\\first;${dir}\\second` } }),
    }).toEqual({ path: "ENOENT", PATH: "started" });
  });

  test("a file that is not an executable fails with EFTYPE", async () => {
    using dir = tempDir("spawn-find", { "empty.exe": "" });
    expect(await run([`${dir}/empty.exe`])).toBe("EFTYPE");
  });

  test.each([
    ["empty entries", (dir: string) => `;;${dir}\\bin;;`],
    ["a trailing separator", (dir: string) => `${dir}\\bin\\`],
    ["forward slashes", (dir: string) => `${dir.replaceAll("\\", "/")}/bin`],
    ["entries that do not exist or are no paths", (dir: string) => `Q:\\no;<>|;${dir}\\bin`],
    ["an entry longer than any path", (dir: string) => `${Buffer.alloc(30000, "a")};${dir}\\bin`],
  ])("PATH with %s", async (_, PATH) => {
    using dir = tree(["bin/tool.exe"]);
    expect(await run(["tool", ...sayStarted], { env: { PATH: PATH(String(dir)) } })).toBe("started");
  });

  test.each([";", ";.;"])("PATH=%j finds nothing", async PATH => {
    using dir = tempDir("spawn-find", {});
    expect(await run(["no-such-tool"], { cwd: String(dir), env: { PATH } })).toBe("ENOENT");
  });

  test.each([";.;", ""])("PATH=%j still finds a program in cwd", async PATH => {
    using dir = tree(["tool.exe"]);
    expect(await run(["tool", ...sayStarted], { cwd: String(dir), env: { PATH } })).toBe("started");
  });

  test("cwd comes before PATH, and an earlier entry before a later one", async () => {
    using dir = tempDir("spawn-find", {
      "cwd/one.cmd": "@echo cwd\r\n",
      "a/one.cmd": "@echo a\r\n",
      "a/two.cmd": "@echo a\r\n",
      "b/two.cmd": "@echo b\r\n",
    });
    const options = { cwd: `${dir}\\cwd`, env: { PATH: `${dir}\\a;${dir}\\b` } };
    expect([await run(["one"], options), await run(["two"], options)]).toEqual(["cwd", "a"]);
  });

  describe("a batch file", () => {
    const script = "@echo [%~1] [%~2]\r\n@exit /b 0\r\n";
    const folders = ["plain", "with space", "bang!", "\u00e9\u4e16"];

    test.each(folders)("runs from a folder named %j", async folder => {
      using dir = tempDir("spawn-batch", { [`${folder}/tool.cmd`]: script, [`${folder}/tool.bat`]: script });
      expect([
        await run([`${dir}\\${folder}\\tool.cmd`, "a", "b"]),
        await run([`${dir}\\${folder}\\tool.bat`, "a", "b"]),
      ]).toEqual(["[a] [b]", "[a] [b]"]);
    });

    test("takes an argument that has a space or is empty", async () => {
      using dir = tempDir("spawn-batch", { "tool.cmd": script });
      expect([await run([`${dir}\\tool.cmd`, "a b", "c"]), await run([`${dir}\\tool.cmd`, "", "c"])]).toEqual([
        "[a b] [c]",
        "[] [c]",
      ]);
    });

    test.each([...folders, "(parens)", "com,ma", "e=q", "x (86)"])(
      "is found through a PATH entry named %j",
      async folder => {
        using dir = tempDir("spawn-batch", { [`${folder}/tool.cmd`]: script });
        expect(await run(["tool", "a b", "c"], { env: { PATH: `${dir}\\${folder}` } })).toBe("[a b] [c]");
      },
    );

    test("runs by a path with forward slashes", async () => {
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
    const printCwd = [bunExe(), "-p", "process.cwd()"];
    test.each([
      ["a trailing separator", (dir: string) => `${dir}\\sub\\`],
      ["forward slashes", (dir: string) => `${dir.replaceAll("\\", "/")}/sub`],
      [". and ..", (dir: string) => `${dir}\\.\\sub\\..\\sub`],
      ["a path relative to this process", (dir: string) => path.relative(process.cwd(), `${dir}\\sub`)],
      ["no drive letter", (dir: string) => `${dir.slice(2)}\\sub`],
    ])("with %s", async (name, cwd) => {
      using dir = tempDir("spawn-cwd", { "sub/file": "" });
      const sameDrive = String(dir)[0].toUpperCase() === process.cwd()[0].toUpperCase();
      const given = name === "no drive letter" && !sameDrive ? `${dir}\\sub` : cwd(String(dir));
      expect(realpathSync.native(await run(printCwd, { cwd: given }))).toBe(realpathSync.native(`${dir}\\sub`));
    });

    test("that is the root of a drive", async () => {
      const root = path.parse(process.cwd()).root;
      expect(await run(printCwd, { cwd: root })).toBe(root);
    });

    test("on a share", async () => {
      using dir = tempDir("spawn-cwd", { "sub/file": "here" });
      const cwd = `\\\\localhost\\${String(dir)[0]}$${String(dir).slice(2)}\\sub`;
      expect(await run([bunExe(), "-p", "require('fs').readFileSync('file', 'utf8')"], { cwd })).toBe("here");
    });

    test("with characters outside the basic plane", async () => {
      using dir = tempDir("spawn-cwd", { "\u{1F600} \u00e9/file": "here" });
      const cwd = `${dir}\\\u{1F600} \u00e9`;
      expect(await run([bunExe(), "-p", "path.basename(process.cwd())"], { cwd })).toBe("\u{1F600} \u00e9");
    });

    test("that is missing or a file fails with ENOENT", async () => {
      using dir = tempDir("spawn-cwd", { file: "" });
      expect([await run(printCwd, { cwd: `${dir}\\missing` }), await run(printCwd, { cwd: `${dir}\\file` })]).toEqual([
        "ENOENT",
        "ENOENT",
      ]);
    });
  });
});
