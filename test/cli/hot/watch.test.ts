import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir, tempDirWithFiles } from "harness";
import { renameSync, writeFileSync } from "node:fs";
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

// On Windows `bun test --watch` runs under a watcher-manager parent process,
// which makes the stderr sync points below racy there.
describe.skipIf(isWindows)("watch mode detects atomic saves", () => {
  // A test file that writes into the watched directory while it runs. The
  // watcher busts the resolver's directory cache on any event in that
  // directory, so the *next* test file's load re-reads the directory. That
  // rebuilt cache generation is the one consulted when the rename below is
  // seen, and it has never resolved the first file (editors, loggers, and
  // bun's own terminal output all produce this kind of activity).
  const noisyTestFile = (name: string) => `
    import { test, expect } from "bun:test";
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";

    test("${name} initial", async () => {
      writeFileSync(join(import.meta.dir, "noise.log"), "${name}");
      // Give the watcher thread time to see the event before the next test
      // file is loaded.
      await Bun.sleep(500);
      expect(1).toBe(1);
    });
  `;

  test("bun test --watch re-runs a test file replaced by write-temp-then-rename", async () => {
    using dir = tempDir("watch-atomic-save", {
      "package.json": JSON.stringify({ name: "watch-atomic-save", type: "module" }),
      "a.test.ts": noisyTestFile("a"),
      "b.test.ts": noisyTestFile("b"),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--watch", "--no-clear-screen"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    async function waitFor(needle: string, from = 0): Promise<void> {
      while (!buf.slice(from).includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed before seeing ${JSON.stringify(needle)}\n${buf}`);
        buf += decoder.decode(value, { stream: true });
      }
    }

    // Wait for the first full run so both files are loaded and watched.
    await waitFor("Ran 2 tests across 2 files");

    // Replace whichever file was loaded first the way editors save: write a
    // temp file, then rename it over the original. The original inode (and
    // its per-file watch) is gone, so only the directory event can report
    // this change.
    const first = buf.indexOf("a.test.ts:") < buf.indexOf("b.test.ts:") ? "a" : "b";
    const target = join(String(dir), `${first}.test.ts`);
    const before = buf.length;
    writeFileSync(
      `${target}.tmp`,
      `import { test, expect } from "bun:test";\ntest("${first} atomically saved", () => { expect(1).toBe(1); });\n`,
    );
    renameSync(`${target}.tmp`, target);

    await waitFor(`${first} atomically saved`, before);
    await waitFor("Ran 2 tests across 2 files", before);
    expect(buf.slice(before)).toContain(`${first} atomically saved`);

    proc.kill();
    reader.releaseLock();
  }, 60_000);
});
