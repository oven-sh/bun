/**
 * This test runs under `bun test` and (via node:test/node:assert) under
 * `node --experimental-strip-types --test`, so it imports nothing from the harness:
 * `fs.mkdtempSync` stands in for `tempDir`, and `process.env` for `bunEnv`.
 *
 * node sets the file as the `path` of a spawn that fails, whichever call failed and whatever `argv0` is:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L1126-L1130 (spawnSync)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L284-L291 ('error' event)
 */
import assert from "node:assert";
import { ChildProcess, execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { promisify } from "node:util";

const exe = process.execPath;
const env = { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" };
const isWindows = process.platform === "win32";

function tempDir() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "spawn-error-path-")));
  return { dir, [Symbol.dispose]: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const fields = (error: any) => ({
  code: error?.code,
  path: error?.path,
  syscall: error?.syscall,
  spawnargs: error?.spawnargs,
});

// The 'error' event of a spawn that fails with one of the codes that node reports on the next tick.
function errorEvent(child: ChildProcess) {
  const { promise, resolve, reject } = Promise.withResolvers<Error>();
  child.once("error", resolve);
  child.once("spawn", () => reject(new Error("the spawn did not fail")));
  child.once("close", () => reject(new Error("the child closed with no 'error' event")));
  return promise;
}

describe("a spawn that fails names the file as its path", () => {
  // Every call that can fail for want of a descriptor is tried with none left: the pipes of the child, and in
  // bun the event loop of the first spawnSync. None of them takes the file.
  test("when the process has no descriptor left", { skip: isWindows && "Windows has no RLIMIT_NOFILE" }, async () => {
    const script = `
      const cp = require("node:child_process");
      const fs = require("node:fs");
      const os = require("node:os");
      // A path, so that nothing searches PATH for the file: with no descriptor left that search finds nothing.
      const file = process.execPath;
      const args = ["-e", "0"];
      const fields = e => e && { code: e.code, errno: e.errno, path: e.path, syscall: e.syscall, spawnargs: e.spawnargs };
      function thrown(call) {
        try {
          call();
        } catch (e) {
          return fields(e);
        }
      }
      function errorEvent(child) {
        return new Promise(resolve => {
          child.once("error", e => resolve(fields(e)));
          child.once("spawn", () => resolve("spawned"));
        });
      }
      const held = [];
      function takeEveryDescriptor() {
        try {
          for (;;) held.push(fs.openSync(os.devNull, "r"));
        } catch {}
      }
      function release() {
        for (const fd of held.splice(0)) fs.closeSync(fd);
      }
      (async () => {
        const errors = {};
        takeEveryDescriptor();
        errors.firstSpawnSync = fields(cp.spawnSync(file, args, { stdio: "pipe" }).error);
        release();

        // A debug build of bun reads its internal modules from disk on first use, and that needs a descriptor.
        // So each call below fails once for a missing file first.
        const missing = "/no/such/file";
        cp.spawnSync(missing, args, { stdio: "pipe" });
        thrown(() => cp.execFileSync(missing, args, { stdio: "pipe" }));
        thrown(() => cp.execSync("exit 0", { stdio: "pipe", shell: missing }));
        await errorEvent(cp.spawn(missing, args, { stdio: "pipe" }));
        await errorEvent(cp.fork("no-such-module.js", ["a"], { execPath: missing, execArgv: [] }));

        takeEveryDescriptor();
        errors.spawnSync = fields(cp.spawnSync(file, args, { stdio: "pipe" }).error);
        errors.spawnSyncWithArgv0 = fields(cp.spawnSync(file, args, { stdio: "pipe", argv0: "x" }).error);
        errors.execFileSync = thrown(() => cp.execFileSync(file, args, { stdio: "pipe" }));
        errors.execSync = thrown(() => cp.execSync("exit 0", { stdio: "pipe" }));
        errors.spawn = await errorEvent(cp.spawn(file, args, { stdio: "pipe" }));
        errors.spawnWithArgv0 = await errorEvent(cp.spawn(file, args, { stdio: "pipe", argv0: "x" }));
        errors.fork = await errorEvent(cp.fork("no-such-module.js", ["a"], { execArgv: [] }));
        // \`cgroup\` is an option of bun, and node ignores it. Bun opens the cgroup before the pipes, so that is
        // the call that fails here.
        errors.spawnSyncWithCgroup = fields(
          cp.spawnSync(file, args, { stdio: "pipe", cgroup: process.env.CGROUP }).error,
        );
        release();
        console.log(JSON.stringify(errors));
      })();`;
    // The limit is low so that the loop above is short. A runtime cannot raise it again: `ulimit -n` also sets
    // the hard limit.
    using tmp = tempDir();
    const { stdout } = await promisify(execFile)(
      "/bin/sh",
      ["-c", 'ulimit -n 64 && exec "$1" -e "$2"', "sh", exe, script],
      { env: { ...env, CGROUP: tmp.dir } },
    );

    const emfile = { code: "EMFILE", errno: -os.constants.errno.EMFILE };
    const ofSpawnSync = { ...emfile, path: exe, syscall: "spawnSync " + exe, spawnargs: ["-e", "0"] };
    const ofSpawn = { ...emfile, path: exe, syscall: "spawn " + exe, spawnargs: ["-e", "0"] };
    assert.deepStrictEqual(JSON.parse(stdout), {
      firstSpawnSync: ofSpawnSync,
      spawnSync: ofSpawnSync,
      spawnSyncWithArgv0: ofSpawnSync,
      execFileSync: ofSpawnSync,
      execSync: { ...emfile, path: "/bin/sh", syscall: "spawnSync /bin/sh", spawnargs: ["-c", "exit 0"] },
      spawn: ofSpawn,
      spawnWithArgv0: ofSpawn,
      fork: { ...ofSpawn, spawnargs: ["no-such-module.js", "a"] },
      spawnSyncWithCgroup: ofSpawnSync,
    });
  });

  test("when argv0 is another name", async () => {
    using tmp = tempDir();
    // With the extension, Windows gives the name to the system and does not search for it first.
    const file = path.join(tmp.dir, "no-such-executable.exe");
    const expected = { code: "ENOENT", path: file, spawnargs: ["a"] };
    assert.deepStrictEqual(
      {
        spawnSync: fields(spawnSync(file, ["a"], { argv0: "x", env }).error),
        spawn: fields(await errorEvent(spawn(file, ["a"], { argv0: "x", env }))),
      },
      {
        spawnSync: { ...expected, syscall: "spawnSync " + file },
        spawn: { ...expected, syscall: "spawn " + file },
      },
    );
  });

  // `cgroup` is an option of bun. A spawn that cannot enter its cgroup is no exception: node sets the file whatever
  // made the spawn fail (a missing `cwd` too), and the message still names the cgroup.
  test(
    "when it cannot enter its cgroup",
    { skip: (!process.versions.bun || process.platform !== "linux") && "cgroup is an option of bun on Linux" },
    async () => {
      using tmp = tempDir();
      const cgroup = path.join(tmp.dir, "no-such-cgroup");
      const options = { cgroup, env } as object;
      const ofSpawnSync = spawnSync(exe, ["-e", "0"], options).error;
      const ofSpawn = await errorEvent(spawn(exe, ["-e", "0"], options));
      const expected = { code: "ENOENT", path: exe, spawnargs: ["-e", "0"], messageNamesCgroup: true };
      assert.deepStrictEqual(
        {
          spawnSync: { ...fields(ofSpawnSync), messageNamesCgroup: ofSpawnSync?.message.includes(cgroup) },
          spawn: { ...fields(ofSpawn), messageNamesCgroup: ofSpawn.message.includes(cgroup) },
        },
        {
          spawnSync: { ...expected, syscall: "spawnSync " + exe },
          spawn: { ...expected, syscall: "spawn " + exe },
        },
      );
    },
  );

  // `spawn()` refuses an empty file. The constructor does not, and node then leaves the file out of `path` and of
  // `syscall`.
  test("and no path when the file is empty", async () => {
    const child = new ChildProcess() as ChildProcess & { spawn(options: object): void };
    const event = errorEvent(child);
    child.spawn({ file: "", args: [""], stdio: "pipe" });
    const error = await event;
    assert.deepStrictEqual(
      { ...fields(error), hasPath: Object.hasOwn(error, "path") },
      { code: "ENOENT", path: undefined, syscall: "spawn", spawnargs: [], hasPath: false },
    );
  });

  // A TypeError about an option is not a spawn that failed. node throws it, and bun gives it as the `error` of the
  // result.
  test("and no path when an option is at fault", () => {
    let error: unknown;
    try {
      error = spawnSync(exe, ["-e", "0"], { env: { ...env, A: Symbol("a") as unknown as string } }).error;
    } catch (thrown) {
      error = thrown;
    }
    assert.deepStrictEqual(
      { isTypeError: error instanceof TypeError, hasPath: Object.hasOwn(error as object, "path") },
      { isTypeError: true, hasPath: false },
    );
  });
});
