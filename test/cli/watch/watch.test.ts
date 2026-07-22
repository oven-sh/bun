import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it } from "bun:test";
import { bunEnv, bunExe, isBroken, isWindows, tempDir, tmpdirSync } from "harness";
import { chmodSync, copyFileSync, linkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let watchee: Subprocess;

for (const dir of ["dir", "©️"]) {
  it.todoIf(isBroken && isWindows)(
    `should watch files${dir === "dir" ? "" : " (non-ascii path)"}`,
    async () => {
      const cwd = join(tmpdirSync(), dir);
      const path = join(cwd, "watchee.js");

      const updateFile = async (i: number) => {
        await Bun.write(path, `console.log(${i}, __dirname);`);
      };

      let i = 0;
      await updateFile(i);
      await Bun.sleep(1000);
      watchee = spawn({
        cwd,
        cmd: [bunExe(), "--watch", "watchee.js"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      for await (const line of watchee.stdout) {
        if (i == 10) break;
        var str = new TextDecoder().decode(line);
        expect(str).toContain(`${i} ${cwd}`);
        i++;
        await updateFile(i);
      }
      rmSync(path);
    },
    10000,
  );
}

afterEach(() => {
  watchee?.kill();
});

// The executable can be deleted or replaced while `--watch` is running (bun
// upgrade, a package reinstall, a rebuild). The re-exec reload must then fail
// with a clean error instead of "panic: Unexpected error while reloading".
// Windows reloads through a watcher-manager parent process instead of exec,
// so this scenario does not apply there.
it.skipIf(isWindows)("should exit with a clean error when the executable is gone at reload time", async () => {
  using dir = tempDir("watch-exe-gone", {
    "app/entry.js": "console.log('VERSION_1');",
  });
  // A private copy of the executable that the test can delete. It lives
  // outside the watched directory so deleting it does not itself count as a
  // file change. Hardlink when possible to avoid copying large debug
  // builds; fall back to a real copy across filesystems.
  const exeCopy = join(String(dir), "bun-copy");
  try {
    linkSync(bunExe(), exeCopy);
  } catch {
    copyFileSync(bunExe(), exeCopy);
    chmodSync(exeCopy, 0o755);
  }

  await using proc = spawn({
    cmd: [exeCopy, "--watch", "entry.js"],
    cwd: join(String(dir), "app"),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Wait for the initial run to finish; the entry file is registered with
  // the watcher before it executes, so a change written after this output
  // is guaranteed to trigger a reload.
  const firstRun = Promise.withResolvers<void>();
  const stdoutDone = (async () => {
    let output = "";
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      output += decoder.decode(chunk, { stream: true });
      if (output.includes("VERSION_1")) firstRun.resolve();
    }
  })();
  await firstRun.promise;

  // Delete the executable out from under the process, then trigger a reload.
  rmSync(exeCopy);
  writeFileSync(join(String(dir), "app", "entry.js"), "console.log('VERSION_2');");

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  await stdoutDone;
  expect(stderr).toContain("Failed to reload process");
  expect(stderr).toContain("ENOENT");
  expect(exitCode).toBe(1);
});

// On Linux, a deleted-then-recreated executable (how upgrades and package
// reinstalls land) makes `/proc/self/exe` read "<path> (deleted)" while a
// fresh binary sits at the original path. The reload must pick up the
// replacement instead of crashing.
it.skipIf(isWindows)("should reload into the replacement when the executable is replaced", async () => {
  using dir = tempDir("watch-exe-replaced", {
    "app/entry.js": "console.log('VERSION_1');",
  });
  const exeCopy = join(String(dir), "bun-copy");
  const installExe = () => {
    try {
      linkSync(bunExe(), exeCopy);
    } catch {
      copyFileSync(bunExe(), exeCopy);
      chmodSync(exeCopy, 0o755);
    }
  };
  installExe();

  await using proc = spawn({
    cmd: [exeCopy, "--watch", "entry.js"],
    cwd: join(String(dir), "app"),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const firstRun = Promise.withResolvers<void>();
  const secondRun = Promise.withResolvers<void>();
  const stdoutDone = (async () => {
    let output = "";
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      output += decoder.decode(chunk, { stream: true });
      if (output.includes("VERSION_1")) firstRun.resolve();
      if (output.includes("VERSION_2")) secondRun.resolve();
    }
  })();
  await firstRun.promise;

  // Replace the executable (delete + recreate, same path, new inode), then
  // trigger a reload. The reload re-execs and must land on the replacement.
  rmSync(exeCopy);
  installExe();
  writeFileSync(join(String(dir), "app", "entry.js"), "console.log('VERSION_2');");

  const result = await Promise.race([
    secondRun.promise.then(() => "reloaded" as const),
    proc.exited.then(code => `exited with code ${code} before reloading` as const),
  ]);
  expect(result).toBe("reloaded");
  proc.kill();
  await Promise.all([proc.exited, stdoutDone]);
});
