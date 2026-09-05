import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir, tempDirWithFiles } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe.todoIf(isBroken && isWindows)("--watch works", async () => {
  for (const watchedFile of ["entry.js", "tmp.js"]) {
    test(`with ${watchedFile}`, async () => {
      await using tmpdir_ = tempDir("watch-fixture", {
        "tmp.js": "console.log('hello #1')",
        "entry.js": "import './tmp.js'",
        "package.json": JSON.stringify({ name: "foo", version: "0.0.1" }),
      });
      await Bun.sleep(1000);
      const tmpfile = join(tmpdir_, "tmp.js");
      const process = spawn({
        cmd: [bunExe(), "--watch", join(tmpdir_, watchedFile)],
        cwd: tmpdir_,
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
      });
      const { stdout } = process;

      const iter = forEachLine(stdout);
      let { value: line, done } = await iter.next();
      expect(done).toBe(false);
      expect(line).toBe("hello #1");

      await writeFile(tmpfile, "console.log('hello #2')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #2");

      await writeFile(tmpfile, "console.log('hello #3')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #3");

      await writeFile(tmpfile, "console.log('hello #4')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #4");

      await writeFile(tmpfile, "console.log('hello #5')");
      ({ value: line } = await iter.next());
      expect(line).toBe("hello #5");

      process.kill("SIGKILL");
      await process.exited;
    });
  }
});

function workspaceFixture(prefix: string) {
  const appSource = (app: number) => `import { value } from "@test/db";\nconsole.log("[app]", ${app}, value);\n`;
  const root = tempDirWithFiles(prefix, {
    "packages/db/package.json": JSON.stringify({ name: "@test/db", main: "index.js" }),
    "packages/db/index.js": `export const value = 1;\n`,
    "apps/myapp/package.json": JSON.stringify({ name: "myapp" }),
    "apps/myapp/index.js": appSource(1),
  });
  mkdirSync(join(root, "apps/myapp/node_modules/@test"), { recursive: true });
  symlinkSync(join(root, "packages/db"), join(root, "apps/myapp/node_modules/@test/db"), "junction");
  return { root, appSource };
}

// https://github.com/oven-sh/bun/issues/9547
//
// The Windows watcher is a recursive ReadDirectoryChangesW rooted at the cwd.
// A workspace package reached through a node_modules symlink resolves to its
// real path in a sibling tree, so before this fix the import was appended to
// the watch list but the change never fired and the process printed "is not
// in the project directory and will not be watched" once per imported file
// per reload. On POSIX the per-file inotify/kqueue watch follows the inode
// and already fires, so the reload assertion only exercises the fix on
// Windows; the stderr assertion (no warning, no crash) is meaningful
// everywhere. Every --watch reload on Windows is a fresh process, so this
// covers root registration; the multi-root lifecycle inside one process is
// covered by the --hot test below.
test.concurrent("--watch picks up changes in a linked workspace package outside the cwd", async () => {
  const { root, appSource } = workspaceFixture("watch-workspace");
  const dbIndex = join(root, "packages/db/index.js");
  const appIndex = join(root, "apps/myapp/index.js");

  await using watcher = spawn({
    cmd: [bunExe(), "--watch", "index.js"],
    cwd: join(root, "apps/myapp"),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  (async () => {
    for await (const chunk of watcher.stderr) stderr += new TextDecoder().decode(chunk);
  })();

  // Alternate edits between the out-of-cwd package and the in-cwd app. Re-save
  // the target generation on every line until it appears; without the fix no
  // event ever fires for packages/db on Windows and the loop never advances
  // past (1, 1).
  const iter = forEachLine(watcher.stdout);
  let db = 1;
  let app = 1;
  for await (const line of iter) {
    expect(stderr).not.toContain("is not in the project directory");
    if (line === `[app] ${app} ${db}`) {
      if (db === 4 && app === 4) break;
      if (db <= app) db += 1;
      else app += 1;
    }
    if (db > app) await writeFile(dbIndex, `export const value = ${db};\n`);
    else await writeFile(appIndex, appSource(app));
  }
  expect({ db, app }).toEqual({ db: 4, app: 4 });
  expect(stderr).not.toContain("is not in the project directory");
});

// The multi-root lifecycle only runs inside one long-lived process, which on
// Windows means --hot (a --watch reload is a fresh process per generation):
// per-root re-arm rotation across completions, a deleted secondary root dying
// without taking the cwd root down, and covers() skipping the dead root and
// opening a fresh one when the recreated package is re-imported.
test.concurrent.skipIf(!isWindows)("--hot survives a linked package being deleted and recreated", async () => {
  const { root, appSource } = workspaceFixture("hot-workspace-rm");
  const dbIndex = join(root, "packages/db/index.js");
  const appIndex = join(root, "apps/myapp/index.js");

  await using runner = spawn({
    cmd: [bunExe(), "--hot", "index.js"],
    cwd: join(root, "apps/myapp"),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  (async () => {
    for await (const chunk of runner.stderr) stderr += new TextDecoder().decode(chunk);
  })();

  const iter = forEachLine(runner.stdout);
  // Phases, advanced when the expected line appears; each phase's edit is
  // re-saved on every other line so a write that lands before the watcher
  // armed its root cannot stall the test.
  // 1. [app] 1 1  startup
  // 2. [app] 2 1  edit the app (cwd root)
  // 3. [app] 2 2  edit the package (secondary root)
  // 4.            delete the package and its junction (kills that root)
  //    [app] 3 2  edit the app again (cwd root must still fire); the
  //               recreated package is re-imported on this reload
  // 5. [app] 3 4  edit only the recreated package (fresh root must fire)
  // 6.            done
  let phase = 1;
  for await (const line of iter) {
    if (phase === 1 && line === "[app] 1 1") {
      phase = 2;
    } else if (phase === 2 && line === "[app] 2 1") {
      phase = 3;
    } else if (phase === 3 && line === "[app] 2 2") {
      // Remove the junction first so packages/db has no second opener and
      // actually leaves delete-pending.
      await rm(join(root, "apps/myapp/node_modules/@test/db"), { recursive: true, force: true });
      await rm(join(root, "packages/db"), { recursive: true, force: true });
      await mkdir(join(root, "packages/db"), { recursive: true });
      await writeFile(join(root, "packages/db/package.json"), JSON.stringify({ name: "@test/db", main: "index.js" }));
      await writeFile(dbIndex, `export const value = 2;\n`);
      symlinkSync(join(root, "packages/db"), join(root, "apps/myapp/node_modules/@test/db"), "junction");
      phase = 4;
    } else if (phase === 4 && line === "[app] 3 2") {
      phase = 5;
    } else if (phase === 5 && line === "[app] 3 4") {
      phase = 6;
      break;
    }

    switch (phase) {
      case 2:
        await writeFile(appIndex, appSource(2));
        break;
      case 3:
        await writeFile(dbIndex, `export const value = 2;\n`);
        break;
      case 4:
        await writeFile(appIndex, appSource(3));
        break;
      case 5:
        await writeFile(dbIndex, `export const value = 4;\n`);
        break;
    }
  }
  expect(phase).toBe(6);
  expect(stderr).not.toContain("is not in the project directory");
});
