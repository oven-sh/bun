import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir } from "harness";
import { rename, writeFile } from "node:fs/promises";
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

// A module imported from outside the process cwd (monorepo sibling package,
// or the entrypoint itself when bun is launched from a different directory)
// used to get only a per-inode inotify/kqueue watch and no parent-directory
// watch. The first atomic rename-save (write temp + rename over; the default
// for vim, sed -i, prettier, JetBrains safe-write, git checkout) replaces the
// inode and orphans that watch, so the save and every later save of that file
// were missed, and under --hot the stale pre-save source was served forever
// from the pinned fd.
describe.skipIf(isWindows)("picks up atomic rename-save of a module outside cwd", () => {
  async function renameSave(path: string, content: string) {
    await writeFile(path + ".next", content);
    await rename(path + ".next", path);
  }

  async function nextEval(iter: AsyncIterator<string>): Promise<string> {
    while (true) {
      const { value, done } = await iter.next();
      if (done) throw new Error("stream ended before an EVAL line");
      if (value.startsWith("EVAL ")) return value;
    }
  }

  for (const flag of ["--watch", "--hot"] as const) {
    test.concurrent(flag, async () => {
      await using dir = tempDir("watch-outside-cwd", {
        "app/entry.ts":
          `import { sh } from "../shared/lib.ts";\n` +
          `globalThis.g = (globalThis.g ?? 0) + 1;\n` +
          `console.log("EVAL g=" + globalThis.g + " shared=" + sh);\n`,
        "shared/lib.ts": `export const sh = "V0";\n`,
      });
      const appDir = join(String(dir), "app");
      const sharedLib = join(String(dir), "shared", "lib.ts");

      await using proc = spawn({
        cmd: [bunExe(), flag, "--no-clear-screen", "entry.ts"],
        cwd: appDir,
        env: bunEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stderr = proc.stderr.text();
      const iter = forEachLine(proc.stdout);

      expect(await nextEval(iter)).toBe("EVAL g=1 shared=V0");

      // Atomic rename-save of the out-of-cwd dependency. Before the fix this
      // produced no reload at all (the per-inode watch is orphaned and the
      // parent dir was not watched).
      await renameSave(sharedLib, `export const sh = "V1";\n`);
      const g2 = flag === "--hot" ? "2" : "1";
      expect(await nextEval(iter)).toBe(`EVAL g=${g2} shared=V1`);

      // Second rename-save on the (now new) inode.
      await renameSave(sharedLib, `export const sh = "V2";\n`);
      const g3 = flag === "--hot" ? "3" : "1";
      expect(await nextEval(iter)).toBe(`EVAL g=${g3} shared=V2`);

      proc.kill("SIGKILL");
      await proc.exited;
      expect(await stderr).not.toContain("is not in the project directory");
    });
  }
});
