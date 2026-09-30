import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn as cpSpawn } from "child_process";
import { chmodSync, copyFileSync } from "fs";
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

// CreateProcess starts .com and .exe images, so those are what a name is completed with, as cmd.exe
// does it. Every image here is a copy of cmd.exe, which sets %COMSPEC% to its own path when it is
// given none.
describe.skipIf(!isWindows).each(["spawn", "spawnSync"] as const)("%s: the image a name with a directory runs", api => {
  let dir: ReturnType<typeof tempDir>;
  const root = () => String(dir);
  beforeAll(() => {
    dir = tempDir("spawn-image", { "cwd/sub/.keep": "", "cwd/directory.exe/.keep": "" });
    for (const image of ["both.com", "both.exe", "sub/tool.exe", "dotted.name.exe", "exact.image"]) {
      copyFileSync(path.join(process.env.SystemRoot!, "System32", "cmd.exe"), path.join(root(), "cwd", image));
    }
  });
  afterAll(() => dir[Symbol.dispose]());

  async function imageOf(file: string) {
    const options = { cwd: path.join(root(), "cwd"), env: {}, stdout: "pipe", stderr: "inherit" } as const;
    const cmd = [file, "/d", "/c", "echo %COMSPEC%"];
    let stdout: string;
    try {
      if (api === "spawnSync") {
        stdout = Bun.spawnSync(cmd, options).stdout.toString();
      } else {
        await using proc = Bun.spawn(cmd, options);
        stdout = await proc.stdout.text();
      }
    } catch (e: any) {
      return e.code;
    }
    return path.relative(path.join(root(), "cwd"), stdout.trim());
  }
  const absolute = (file: string) => path.join(root(), "cwd", file);

  test.each([
    ["the name itself", () => absolute("both.exe"), "both.exe"],
    [".com before .exe", () => absolute("both"), "both.com"],
    ["relative to the cwd option", () => "./both", "both.com"],
    ["/ in the name", () => "sub/tool", "sub\\tool.exe"],
    ["\\ in the name", () => "sub\\tool", "sub\\tool.exe"],
    ["no second dot after one at the end", () => "./both.", "both.com"],
    ["a name with an extension, as it is", () => "./exact.image", "exact.image"],
    ["a name with an extension that is not there as it is", () => "./dotted.name", "dotted.name.exe"],
    ["no drive: the cwd option's", () => absolute("both.exe").slice(2), "both.exe"],
    ["a drive and no root: the cwd option, on that drive", () => root().slice(0, 2) + "sub\\tool.exe", "sub\\tool.exe"],
    ["a directory is not an image", () => "./directory", "ENOENT"],
    ["nothing by that name", () => "./missing", "ENOENT"],
  ])("%s", async (_, file, expected) => {
    expect(await imageOf(file())).toBe(expected);
  });
});

// The name is then looked for the way CreateProcess and cmd.exe look for one: in the child's directory, then along
// this process's own PATH. Windows has a cmd.exe in two directories, and each sets %COMSPEC% to its own path.
describe.skipIf(!isWindows).concurrent("the image a bare name runs when the env option has no PATH", () => {
  const windows = process.env.SystemRoot!;
  const System32 = path.join(windows, "System32");
  const SysWOW64 = path.join(windows, "SysWOW64");

  /** The directory of the cmd.exe that ran, or the code `Bun.spawnSync` threw. */
  async function found(PATH: string, { name = "cmd", cwd = windows, env = {} } = {}) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try {
           const cmd = [${JSON.stringify(name)}, "/d", "/c", "echo %COMSPEC%"];
           const { stdout } = Bun.spawnSync({ cmd, env: {}, cwd: ${JSON.stringify(cwd)} });
           console.log(require("path").basename(require("path").dirname(stdout.toString().trim())));
         } catch (e) {
           console.log(e.code);
         }`,
      ],
      env: { ...bunEnv, NoDefaultCurrentDirectoryInExePath: undefined, ...env, PATH },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { found: stdout.trim(), stderr, exitCode };
  }
  const is = (found: string) => ({ found, stderr: "", exitCode: 0 });

  test.each([
    ["the first entry that has it", `${SysWOW64};${System32}`, "SysWOW64"],
    ["the first entry that has it, the other way round", `${System32};${SysWOW64}`, "System32"],
    ["an entry that does not have it is passed over", `${windows};${SysWOW64};${System32}`, "SysWOW64"],
    ["an entry that is not there is passed over", `${windows}\\nothing here;${SysWOW64}`, "SysWOW64"],
    ["empty entries are passed over", `;;${SysWOW64};;${System32}`, "SysWOW64"],
    ["an entry in quotes", `"${SysWOW64}";${System32}`, "SysWOW64"],
    ["an entry that is quoted in part", `${windows}\\"SysWOW64";${System32}`, "System32"],
    ["an entry that ends in a separator", `${SysWOW64}\\;${System32}`, "SysWOW64"],
    ["an entry relative to the child's directory", `SysWOW64;${System32}`, "SysWOW64"],
    ["nowhere", windows, "ENOENT"],
    ["an empty PATH", "", "ENOENT"],
  ])("%s", async (_name, PATH, expected) => {
    expect(await found(PATH)).toEqual(is(expected));
  });

  // libuv took the closing quote off an entry that is one quote long, and copied 2^64 - 1 characters.
  test.each([`${windows};"`, `"`, `${windows};'`, `${windows};""`, `${windows};";`, `";${SysWOW64}`])(
    "PATH=%s does not end the process",
    async PATH => {
      expect(await found(PATH, { name: "no-such-program" })).toEqual(is("ENOENT"));
    },
  );

  test("the child's directory comes before PATH", async () => {
    expect(await found(System32, { cwd: SysWOW64 })).toEqual(is("SysWOW64"));
  });

  test("the child's directory is left out when NoDefaultCurrentDirectoryInExePath is set", async () => {
    expect(await found(System32, { cwd: SysWOW64, env: { NoDefaultCurrentDirectoryInExePath: "1" } })).toEqual(
      is("System32"),
    );
  });

  test("a name with an extension is looked for as it is", async () => {
    expect(await found(`${SysWOW64};${System32}`, { name: "cmd.exe" })).toEqual(is("SysWOW64"));
  });
});
