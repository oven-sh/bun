import { test, expect } from "bun:test";

import { which } from "bun";
import { rmSync, chmodSync, mkdirSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { cpSync, rmdirSync } from "js/node/fs/export-star-from";
import { isIntelMacOS, isWindows } from "../../../harness";

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

if (isWindows) {
  test("which", () => {
    expect(which("cmd")).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(which("cmd.exe")).toBe("C:\\Windows\\system32\\cmd.exe");
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

    let basedir = join(tmpdir(), "which-test-" + Math.random().toString(36).slice(2));

    rmSync(basedir, { recursive: true, force: true });
    mkdirSync(basedir, { recursive: true });
    writeFixture(join(basedir, "myscript.sh"));
    const abs = realpathSync(join(basedir, "myscript.sh"));

    const origDir = process.cwd();
    try {
      basedir = realpathSync(basedir);

      process.chdir(basedir);
      // Our cwd is not /tmp
      expect(which("myscript.sh")).toBe(abs);

      const orig = process.cwd();
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

      expect(
        // cwd is checked first
        which("myscript.sh", {
          cwd: basedir,
        }),
      ).toBe(abs);
    } finally {
      process.chdir(origDir);
      rmSync(basedir, { recursive: true, force: true });
    }
  });
}
