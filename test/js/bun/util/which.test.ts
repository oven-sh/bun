import { test, expect } from "bun:test";

import { which } from "bun";
import { rmSync, chmodSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmdirSync } from "js/node/fs/export-star-from";

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

    try {
      mkdirSync("myscript.sh");
      chmodSync("myscript.sh", "755");
    } catch (e) {}

    // directories should not be returned
    expect(which("myscript.sh")).toBe(null);

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
