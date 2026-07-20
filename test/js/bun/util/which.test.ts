import { $, which } from "bun";
import { expect, test } from "bun:test";
import { isArm64, isIntelMacOS, isWindows, tempDir, tempDirWithFiles, tmpdirSync } from "harness";
import { chmodSync, existsSync, mkdirSync, realpathSync, rmdirSync, rmSync, symlinkSync } from "node:fs";
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

  // Store-installed CLIs (winget, Store python, pwsh) under
  // %LOCALAPPDATA%\Microsoft\WindowsApps are IO_REPARSE_TAG_APPEXECLINK reparse
  // points. Opening one with CreateFileW (following) fails with
  // ERROR_CANT_ACCESS_FILE, which is not "does not exist": the entry is there
  // and CreateProcess can launch it. bun:ffi is unavailable on Windows arm64.
  test.skipIf(isArm64)("which resolves Windows app-execution aliases (#17328)", () => {
    using dir = tempDir("which-appexeclink", {});
    const base = String(dir);
    const alias = join(base, "myalias.exe");
    const dangling = join(base, "dangling.exe");

    makeAppExecLink(alias);
    symlinkSync(join(base, "no-such-target.exe"), dangling, "file");

    expect({
      which_bare: which("myalias", { PATH: base }),
      which_ext: which("myalias.exe", { PATH: base }),
      existsSync_alias: existsSync(alias),
      existsSync_dangling: existsSync(dangling),
    }).toEqual({
      which_bare: alias,
      which_ext: alias,
      existsSync_alias: true,
      existsSync_dangling: false,
    });
  });

  function makeAppExecLink(target: string) {
    const { dlopen, ptr } = require("bun:ffi");
    const k32 = dlopen("kernel32.dll", {
      CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "ptr" },
      DeviceIoControl: { args: ["ptr", "u32", "ptr", "u32", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
      CloseHandle: { args: ["ptr"], returns: "i32" },
      GetLastError: { args: [], returns: "u32" },
    });

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
    if (h === null || h === -1) throw new Error(`CreateFileW failed: ${k32.symbols.GetLastError()}`);

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
      try {
        rmdirSync("myscript.sh");
      } catch {}
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

      // TODO: only fails on x64 macos
      if (!isIntelMacOS) {
        try {
          mkdirSync("myscript.sh");
          chmodSync("myscript.sh", "755");
        } catch (e) {}

        // directories should not be returned
        expect(which("myscript.sh")).toBe(null);
      }

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
}

test("Bun.which does not look in the current directory for bins", async () => {
  const cwd = process.cwd();
  const dir = tempDirWithFiles("which", {
    "some_program_name": "#!/usr/bin/env sh\necho FAIL\nexit 0\n",
    "some_program_name.cmd": "@echo FAIL\n@exit 0\n",
  });
  process.chdir(dir);
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
  const dir = tempDirWithFiles("which", {
    "some_program_name": "#!/usr/bin/env sh\necho posix\nexit 0\n",
    "some_program_name.cmd": "@echo win32\n@exit 0\n",
    "folder/other_app": "#!/usr/bin/env sh\necho posix\nexit 0\n",
    "folder/other_app.cmd": "@echo win32\n@exit 0\n",
  });
  process.chdir(dir);
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
  const dir = tempDirWithFiles("which-non-ascii-开始学习", {
    "some_program_name": "#!/usr/bin/env sh\necho posix\nexit 0\n",
    "some_program_name.cmd": "@echo win32\n@exit 0\n",
  });

  process.chdir(dir);
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
