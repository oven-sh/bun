import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDirWithFiles } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

describe.todoIf(isBroken && isWindows)("--watch works", async () => {
  for (const watchedFile of ["entry.js", "tmp.js"]) {
    test(`with ${watchedFile}`, async () => {
      const tmpdir_ = tempDirWithFiles("watch-fixture", {
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

// https://github.com/oven-sh/bun/issues/9547
//
// The Windows watcher is a recursive ReadDirectoryChangesW on one root
// (the cwd). A workspace package reached through a node_modules symlink
// resolves to its real path in a sibling tree, so before this fix the
// import was appended to the watch list but the change never fired and the
// process printed "is not in the project directory and will not be watched"
// once per imported file per reload. On POSIX the per-file inotify/kqueue
// watch follows the inode and already fires, so the reload assertion only
// exercises the fix on Windows; the stderr assertion (no warning, no crash)
// is meaningful everywhere.
test.concurrent("picks up changes in a linked workspace package outside the cwd", async () => {
  const root = tempDirWithFiles("watch-workspace", {
    "packages/db/package.json": JSON.stringify({ name: "@test/db", main: "index.js" }),
    "packages/db/index.js": `export const value = 1;\n`,
    "apps/myapp/package.json": JSON.stringify({ name: "myapp" }),
    "apps/myapp/index.js": `import { value } from "@test/db";\nconsole.log("[app]", value);\n`,
  });
  mkdirSync(join(root, "apps/myapp/node_modules/@test"), { recursive: true });
  symlinkSync(
    join(root, "packages/db"),
    join(root, "apps/myapp/node_modules/@test/db"),
    "junction",
  );

  const dbIndex = join(root, "packages/db/index.js");

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

  // Re-save the target generation on every line until it appears. Without
  // the fix no change event ever fires for packages/db on Windows, so the
  // loop never advances past gen 1 and the test times out.
  const iter = forEachLine(watcher.stdout);
  let gen = 1;
  for await (const line of iter) {
    expect(stderr).not.toContain("is not in the project directory");
    if (line === `[app] ${gen}`) {
      if (gen === 5) break;
      gen += 1;
    }
    await writeFile(dbIndex, `export const value = ${gen};\n`);
  }
  expect(gen).toBe(5);
  expect(stderr).not.toContain("is not in the project directory");

  watcher.kill();
});
