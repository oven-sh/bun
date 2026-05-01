import { $, which } from "bun";
import { expect, test } from "bun:test";
import { isIntelMacOS, isWindows, tempDirWithFiles, tmpdirSync } from "harness";
import { chmodSync, mkdirSync, realpathSync, rmdirSync, rmSync } from "node:fs";
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
