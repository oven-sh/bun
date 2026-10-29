/**
 * This test runs under `bun test` and (via node:test/node:assert) under
 * `node --experimental-strip-types --test`, so it imports nothing from the harness.
 *
 * node reports the file as the `path` of a spawn that fails, whatever `argv0` is:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L1127-L1129 (spawnSync)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L286-L291 ('error' event)
 */
import assert from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const exe = process.execPath;
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
const isWindows = process.platform === "win32";

function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "spawn-error-path-")));
  return { dir, [Symbol.dispose]: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// What both runtimes agree on. The message has a different format in each, and names the file in both.
const fields = (error: any, file: string) => ({
  code: error?.code,
  path: error?.path,
  syscall: error?.syscall,
  spawnargs: error?.spawnargs,
  messageNamesFile: String(error?.message).includes(file),
});

// The 'error' event of a spawn that fails with one of the codes that node reports on the next tick.
function errorEvent(file: string, args: string[], options: object) {
  const child = spawn(file, args, options);
  const { promise, resolve, reject } = Promise.withResolvers<Error>();
  child.once("error", resolve);
  child.once("spawn", () => reject(new Error("the spawn did not fail")));
  return promise;
}

describe("a spawn that fails names the file as its path", () => {
  for (const [name, argv0] of [
    ["undefined", undefined],
    ['"x"', "x"],
    ['""', ""],
  ] as const) {
    test(`argv0: ${name}, the file does not exist`, async () => {
      using tmp = tempDir();
      // With the extension, Windows gives the name to the system and does not search for it first.
      const file = path.join(tmp.dir, "no-such-executable.exe");
      const expected = { code: "ENOENT", path: file, spawnargs: ["a"], messageNamesFile: true };
      assert.deepStrictEqual(
        {
          spawnSync: fields(spawnSync(file, ["a"], { argv0, env }).error, file),
          spawn: fields(await errorEvent(file, ["a"], { argv0, env }), file),
        },
        {
          spawnSync: { ...expected, syscall: "spawnSync " + file },
          spawn: { ...expected, syscall: "spawn " + file },
        },
      );
    });

    test(`argv0: ${name}, the cwd does not exist`, async () => {
      using tmp = tempDir();
      const cwd = path.join(tmp.dir, "no-such-dir");
      const expected = { code: "ENOENT", path: exe, spawnargs: ["-e", "0"], messageNamesFile: true };
      assert.deepStrictEqual(
        {
          spawnSync: fields(spawnSync(exe, ["-e", "0"], { argv0, cwd, env }).error, exe),
          spawn: fields(await errorEvent(exe, ["-e", "0"], { argv0, cwd, env }), exe),
        },
        {
          spawnSync: { ...expected, syscall: "spawnSync " + exe },
          spawn: { ...expected, syscall: "spawn " + exe },
        },
      );
    });

    // The file is found on PATH and its interpreter is not: the path is the name as given, not where it was found.
    test(`argv0: ${name}, a name from PATH that cannot start`, { skip: isWindows }, async () => {
      using tmp = tempDir();
      fs.writeFileSync(path.join(tmp.dir, "badtool"), "#!/no/such/interpreter\n", { mode: 0o755 });
      const options = { argv0, env: { ...env, PATH: tmp.dir + path.delimiter + env.PATH } };
      const expected = { code: "ENOENT", path: "badtool", spawnargs: [], messageNamesFile: true };
      assert.deepStrictEqual(
        {
          spawnSync: fields(spawnSync("badtool", [], options).error, "badtool"),
          spawn: fields(await errorEvent("badtool", [], options), "badtool"),
        },
        {
          spawnSync: { ...expected, syscall: "spawnSync badtool" },
          spawn: { ...expected, syscall: "spawn badtool" },
        },
      );
    });

    // ELOOP is not one of the codes that name a missing or forbidden file.
    test(`argv0: ${name}, the file is a symlink to itself`, { skip: isWindows }, () => {
      using tmp = tempDir();
      const file = path.join(tmp.dir, "loop");
      fs.symlinkSync("loop", file);
      assert.deepStrictEqual(fields(spawnSync(file, ["a"], { argv0, env }).error, file), {
        code: "ELOOP",
        path: file,
        syscall: "spawnSync " + file,
        spawnargs: ["a"],
        messageNamesFile: true,
      });
    });
  }

  // The pipes of the child cannot be made, so this error comes from before the spawn call and names no file itself.
  test("the process has no descriptor left", { skip: isWindows }, () => {
    const script = `
      const cp = require("node:child_process");
      const fs = require("node:fs");
      const fields = e => e && { code: e.code, path: e.path, syscall: e.syscall, spawnargs: e.spawnargs };
      function main() {
        const fds = [];
        try {
          for (;;) fds.push(fs.openSync("/dev/null", "r"));
        } catch {}
        const sync = fields(cp.spawnSync("true", ["a"], { stdio: "pipe" }).error);
        cp.spawn("true", ["a"], { stdio: "pipe" }).on("error", error => {
          for (const fd of fds) fs.closeSync(fd);
          console.log(JSON.stringify({ spawnSync: sync, spawn: fields(error) }));
        });
      }
      // A debug build of bun reads its internal modules from disk on first use, and that needs a descriptor.
      cp.spawnSync("true", [], { stdio: "pipe" });
      cp.spawnSync("/no/such/file", [], { stdio: "pipe" });
      cp.spawn("/no/such/file", [], { stdio: "pipe" }).on("error", () => {
        cp.spawn("true", [], { stdio: "pipe" }).on("close", main);
      });`;
    // The limit is low so that the loop above is short. A runtime cannot raise it again: `ulimit -n` also sets the hard limit.
    const { stdout, status } = spawnSync("/bin/sh", ["-c", 'ulimit -n 128 && exec "$1" -e "$2"', "sh", exe, script], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    assert.deepStrictEqual(
      { result: stdout.trim() && JSON.parse(stdout), status },
      {
        result: {
          spawnSync: { code: "EMFILE", path: "true", syscall: "spawnSync true", spawnargs: ["a"] },
          spawn: { code: "EMFILE", path: "true", syscall: "spawn true", spawnargs: ["a"] },
        },
        status: 0,
      },
    );
  });
});
