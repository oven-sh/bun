import { $, which } from "bun";
import { dlopen, ptr } from "bun:ffi";
import { expect, jest, test } from "bun:test";
import { isArm64, isWindows, tempDir, tmpdirSync } from "harness";
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

$.nothrow();

{
  const delim = isWindows ? ";" : ":";
  if (`${delim}${process.env.PATH}${delim}`.includes(`${delim}.${delim}`)) {
    throw new Error("$PATH includes . which will break `Bun.which` tests. This is an environment configuration issue.");
  }
}

function writeFixture(path: string) {
  var fs = require("fs");
  try {
    fs.unlinkSync(path);
  } catch (e) {}

  var script_name = path;
  var script_content = "echo Hello world!";
  fs.writeFileSync(script_name, script_content);
  fs.chmodSync(script_name, "755");
}

test("which rlly long", async () => {
  const longstr = "a".repeat(100000);
  expect(() => which(longstr)).toThrow("bin path is too long");
});

test("which without a command", () => {
  // @ts-expect-error
  expect(which()).toBeNull();
  for (const nothing of [undefined, null, ""] as any[]) expect(which(nothing)).toBeNull();

  // The options are converted all the same.
  const PATH = jest.fn(() => "");
  expect(
    which("", {
      get PATH() {
        return PATH();
      },
    }),
  ).toBeNull();
  expect(PATH).toHaveBeenCalledTimes(1);
  expect(() => which(null as any, { cwd: Symbol() } as any)).toThrow(
    expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a string" }),
  );
});

test("which converts the command, PATH and cwd to strings, in that order", () => {
  using dir = tempDir("which-arguments", { "bin/123": "", "bin/é": "" });
  const bin = join(realpathSync(String(dir)), "bin");
  for (const name of ["123", "é"]) chmodSync(join(bin, name), 0o755);

  const log: string[] = [];
  const stringLike = (name: string, value: string) => ({
    toString() {
      log.push(name);
      return value;
    },
  });
  const found = isWindows ? null : join(bin, "123");
  expect(
    which(stringLike("command", "123") as any, { cwd: stringLike("cwd", bin), PATH: stringLike("PATH", bin) } as any),
  ).toBe(found);
  expect(log).toEqual(["command", "PATH", "cwd"]);
  expect(which(123 as any, { PATH: bin })).toBe(found);
  expect(which(new String("123") as any, { PATH: bin })).toBe(found);
  expect(which("é", { PATH: bin })).toBe(isWindows ? null : join(bin, "é"));
  for (const call of [() => which(Symbol() as any), () => which("123", { PATH: Symbol() } as any)]) {
    expect(call).toThrow(
      expect.objectContaining({ name: "TypeError", message: "Cannot convert a symbol to a string" }),
    );
  }
});

test("which ignores options that are not an object, and Object.prototype", () => {
  const shell = isWindows ? "cmd" : "sh";
  const found = which(shell);
  expect(found).toBeString();
  for (const options of [undefined, null, 1, "PATH", true, 1n, Symbol(), {}, []] as any[]) {
    expect(which(shell, options)).toBe(found);
  }
  expect(which(shell, { PATH: undefined, cwd: undefined })).toBe(found);
  expect(which(shell, { PATH: "" })).toBeNull();
  for (const options of [
    Object.create({ PATH: "" }),
    Object.assign([], { PATH: "" }),
    Object.assign(() => {}, { PATH: "" }),
  ]) {
    expect(which(shell, options)).toBeNull();
  }
  (Object.prototype as any).PATH = "";
  try {
    expect(which(shell, {})).toBe(found);
  } finally {
    delete (Object.prototype as any).PATH;
  }
});

if (isWindows) {
  test("which", () => {
    expect(which("cmd")).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(which("cmd.exe")).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(which("cmd.EXE")).toBe("C:\\Windows\\system32\\cmd.EXE");
    expect(which("cmd.bat")).toBe(null);
    const exe = basename(process.execPath);
    const dir = join(process.execPath, "../");
    expect(which(exe, { PATH: "C:\\Windows\\system32" })).toBe(null);
    expect(which(exe, { PATH: "C:\\Windows\\system32;" + dir })).toBe(process.execPath);
    expect(which(exe, { PATH: dir + ";C:\\Windows\\system32" })).toBe(process.execPath);
    expect(which(exe, { PATH: dir })).toBe(process.execPath);
  });

  // `chcp.com`, `tree.com` and `more.com` live in System32 with no `.exe`
  // sibling, so `.com` has to be probed like libuv does. It is probed after
  // every $PATH directory failed `.exe`/`.cmd`/`.bat`, so a later `.exe` wins
  // over an earlier `.com`. A path with a directory is stat'd as spelled
  // whatever its extension (libuv again), a bare $PATH name only with an
  // executable extension.
  test("which finds .com executables, bare or spelled, relative or absolute", () => {
    using dir = tempDir("which-com", {
      "tool.com": "",
      "dotted.name.exe": "",
      "custom.bin": "",
      "both.com": "",
      "later/both.exe": "",
    });
    const base = String(dir);
    const later = join(base, "later");
    expect({
      bare: which("tool", { PATH: base }),
      spelled: which("tool.com", { PATH: base }),
      absolute: which(join(base, "tool.com")),
      relative: which("./tool.com", { cwd: base }),
      dotted_bare: which("dotted.name", { PATH: base }),
      dotted_spelled: which("dotted.name.exe", { PATH: base }),
      custom_absolute: which(join(base, "custom.bin")),
      custom_bare: which("custom.bin", { PATH: base }),
      custom_no_ext: which("custom", { PATH: base }),
      exe_in_later_dir_wins: which("both", { PATH: `${base};${later}` }),
      com_alone: which("both", { PATH: base }),
      missing: which("tool.exe", { PATH: base }),
      system: which("chcp")?.toLowerCase(),
    }).toEqual({
      bare: join(base, "tool.com"),
      spelled: join(base, "tool.com"),
      absolute: join(base, "tool.com"),
      relative: join(base, "tool.com"),
      dotted_bare: join(base, "dotted.name.exe"),
      dotted_spelled: join(base, "dotted.name.exe"),
      custom_absolute: join(base, "custom.bin"),
      custom_bare: null,
      custom_no_ext: null,
      exe_in_later_dir_wins: join(later, "both.exe"),
      com_alone: join(base, "both.com"),
      missing: null,
      system: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "chcp.com").toLowerCase(),
    });
  });

  // Spawn resolves like which: a dotted `\` path without an executable
  // extension still completes to `.cmd`, and a `.com` in the cwd is found
  // once the $PATH walk failed.
  test("spawn completes a dotted path to .cmd and finds a .com in the cwd", () => {
    const chcp = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "chcp.com");
    using dir = tempDir("which-spawn", { "deploy.prod.cmd": "@echo cmd-ok\r\n" });
    const base = String(dir);
    copyFileSync(chcp, join(base, "whichtest.com"));
    const run = (cmd: string[]) =>
      Bun.spawnSync(cmd, { cwd: base, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
    expect({
      which_dotted: which(join(base, "deploy.prod")),
      spawn_dotted: run([join(base, "deploy.prod")]),
      spawn_com_in_cwd: run(["whichtest"]),
    }).toEqual({
      which_dotted: join(base, "deploy.prod.cmd"),
      spawn_dotted: "cmd-ok",
      spawn_com_in_cwd: expect.stringMatching(/\d+$/),
    });
  });

  // Non-name-surrogate reparse tags (APPEXECLINK) must be treated as existing;
  // only name surrogates (symlinks, mount points) are followed. bun:ffi is
  // unavailable on Windows arm64.
  test.skipIf(isArm64)("which resolves Windows app-execution aliases (#17328)", () => {
    using dir = tempDir("which-appexeclink", { "real.exe": "" });
    const base = String(dir);
    const alias = join(base, "myalias.exe");
    const dangling = join(base, "dangling.exe");
    const goodlink = join(base, "goodlink.exe");

    makeAppExecLink(alias);
    symlinkSync(join(base, "no-such-target.exe"), dangling, "file");
    symlinkSync(join(base, "real.exe"), goodlink, "file");

    expect({
      which_bare: which("myalias", { PATH: base }),
      which_ext: which("myalias.exe", { PATH: base }),
      which_dangling: which("dangling.exe", { PATH: base }),
      which_goodlink: which("goodlink.exe", { PATH: base }),
      existsSync_alias: existsSync(alias),
      existsSync_dangling: existsSync(dangling),
      existsSync_goodlink: existsSync(goodlink),
    }).toEqual({
      which_bare: alias,
      which_ext: alias,
      which_dangling: null,
      which_goodlink: goodlink,
      existsSync_alias: true,
      existsSync_dangling: false,
      existsSync_goodlink: true,
    });
  });

  function makeAppExecLink(target: string) {
    const k32 = dlopen("kernel32.dll", {
      CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "u64" },
      DeviceIoControl: { args: ["u64", "u32", "ptr", "u32", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
      CloseHandle: { args: ["u64"], returns: "i32" },
      GetLastError: { args: [], returns: "u32" },
    });

    const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;
    const GENERIC_WRITE = 0x40000000;
    const SHARE_ALL = 0x7;
    const CREATE_NEW = 1;
    const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    const FSCTL_SET_REPARSE_POINT = 0x000900a4;
    const IO_REPARSE_TAG_APPEXECLINK = 0x8000001b;

    const wpath = Buffer.from(target + "\0", "utf16le");
    const h = k32.symbols.CreateFileW(
      ptr(wpath),
      GENERIC_WRITE,
      SHARE_ALL,
      null,
      CREATE_NEW,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      null,
    );
    if (h === INVALID_HANDLE_VALUE) throw new Error(`CreateFileW failed: ${k32.symbols.GetLastError()}`);

    const strings = ["Bun.Test_1.0.0.0_x64__fake", "Bun.Test_fake!App", "C:\\Windows\\System32\\cmd.exe", "0"];
    const strbuf = Buffer.concat(strings.map(s => Buffer.from(s + "\0", "utf16le")));
    const dataLen = 4 + strbuf.length;
    const buf = Buffer.alloc(8 + dataLen);
    buf.writeUInt32LE(IO_REPARSE_TAG_APPEXECLINK, 0);
    buf.writeUInt16LE(dataLen, 4);
    buf.writeUInt16LE(0, 6);
    buf.writeUInt32LE(3, 8);
    strbuf.copy(buf, 12);

    const bytesReturned = Buffer.alloc(4);
    const ok = k32.symbols.DeviceIoControl(
      h,
      FSCTL_SET_REPARSE_POINT,
      ptr(buf),
      buf.length,
      null,
      0,
      ptr(bytesReturned),
      null,
    );
    const err = k32.symbols.GetLastError();
    k32.symbols.CloseHandle(h);
    if (!ok) throw new Error(`DeviceIoControl(FSCTL_SET_REPARSE_POINT) failed: ${err}`);
  }
} else {
  test("which", () => {
    {
      let existing = which("myscript.sh");
      if (existing !== null) {
        rmSync(existing!, { recursive: true, force: true });
      }
    }

    let basedir = tmpdirSync();

    rmSync(basedir, { recursive: true, force: true });
    mkdirSync(basedir, { recursive: true });
    writeFixture(join(basedir, "myscript.sh"));
    const abs = realpathSync(join(basedir, "myscript.sh"));

    const origDir = process.cwd();
    try {
      basedir = realpathSync(basedir);

      process.chdir(basedir);
      expect(which("myscript.sh")).toBe(null);

      process.chdir(tmpdir());
      // Our cwd is not /tmp
      expect(which("myscript.sh")).toBe(null);

      expect(
        // You can override PATH
        which("myscript.sh", {
          PATH: basedir,
        }),
      ).toBe(abs);

      expect(
        // PATH works like the $PATH environment variable, respecting colons
        which("myscript.sh", {
          PATH: "/not-tmp:" + basedir,
        }),
      ).toBe(abs);

      // "bun" is in our PATH
      expect(which("bun")!.length > 0).toBe(true);

      expect(
        which("myscript.sh", {
          PATH: "/not-tmp",
        }),
      ).toBe(null);
    } finally {
      process.chdir(origDir);
      rmSync(basedir, { recursive: true, force: true });
    }
  });

  // An open(O_EXEC) probe accepted both on musl, where O_EXEC is O_PATH.
  test("which skips a directory and a file that is not executable on PATH", () => {
    using dir = tempDir("which-not-executable", {
      "a/tool": {},
      "b/tool": "#!/bin/sh\n",
      "c/data": "not executable\n",
    });
    const base = String(dir);
    chmodSync(join(base, "b/tool"), 0o755);
    chmodSync(join(base, "c/data"), 0o644);

    expect({
      directory_then_tool: which("tool", { PATH: `${join(base, "a")}:${join(base, "b")}` }),
      directory: which("tool", { PATH: join(base, "a") }),
      not_executable: which("data", { PATH: join(base, "c") }),
    }).toEqual({
      directory_then_tool: join(base, "b/tool"),
      directory: null,
      not_executable: null,
    });
  });
}

test("Bun.which does not look in the current directory for bins", async () => {
  const cwd = process.cwd();
  await using dir = tempDir("which", {
    "some_program_name": "#!/usr/bin/env sh\necho FAIL\nexit 0\n",
    "some_program_name.cmd": "@echo FAIL\n@exit 0\n",
  });
  process.chdir(String(dir));
  try {
    if (!isWindows) {
      await $`chmod +x ./some_program_name`;
    }

    expect(which("some_program_name")).toBe(null);
    expect((await $`some_program_name`).exitCode).not.toBe(0);
  } finally {
    process.chdir(cwd);
  }
});

test("Bun.which does look in the current directory when given a path with a slash", async () => {
  const cwd = process.cwd();
  await using dir = tempDir("which", {
    "some_program_name": "#!/usr/bin/env sh\necho posix\nexit 0\n",
    "some_program_name.cmd": "@echo win32\n@exit 0\n",
    "folder/other_app": "#!/usr/bin/env sh\necho posix\nexit 0\n",
    "folder/other_app.cmd": "@echo win32\n@exit 0\n",
  });
  process.chdir(String(dir));
  try {
    if (!isWindows) {
      await $`chmod +x ./some_program_name`;
      await $`chmod +x ./folder/other_app`;
    }

    const suffix = isWindows ? ".cmd" : "";

    expect(which("./some_program_name")).toBe(join(dir, "some_program_name" + suffix));
    expect((await $`./some_program_name`.text()).trim()).toBe(isWindows ? "win32" : "posix");
    expect(which("./folder/other_app")).toBe(join(dir, "folder/other_app" + suffix));
    expect((await $`./folder/other_app`.text()).trim()).toBe(isWindows ? "win32" : "posix");
    expect(which("folder/other_app")).toBe(join(dir, "folder/other_app" + suffix));
    expect((await $`folder/other_app`.text()).trim()).toBe(isWindows ? "win32" : "posix");
  } finally {
    process.chdir(cwd);
  }
});

test("Bun.which can find executables in a non-ascii directory", async () => {
  const cwd = process.cwd();
  await using dir = tempDir("which-non-ascii-开始学习", {
    "some_program_name": "#!/usr/bin/env sh\necho posix\nexit 0\n",
    "some_program_name.cmd": "@echo win32\n@exit 0\n",
  });

  process.chdir(String(dir));
  try {
    if (!isWindows) {
      await $`chmod +x ./some_program_name`;
    }

    const suffix = isWindows ? ".cmd" : "";
    expect(which("./some_program_name")).toBe(join(dir, "some_program_name" + suffix));
    expect((await $`./some_program_name`.text()).trim()).toBe(isWindows ? "win32" : "posix");
  } finally {
    process.chdir(cwd);
  }
});
