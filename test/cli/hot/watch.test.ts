import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isWindows, tempDir } from "harness";
import { writeFile } from "node:fs/promises";
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

// The test runner has no in-process reload, so `bun test --hot` restarts the
// run on change exactly like `--watch` does (it used to run the suite once and
// exit).
describe.todoIf(isBroken && isWindows)("bun test re-runs on file change", () => {
  const testFile = (version: string) =>
    `import { test } from "bun:test";\ntest("a", () => { console.error("RAN ${version}"); });\n`;

  for (const args of [
    ["test", "--watch"],
    ["test", "--hot"],
    ["--hot", "test"],
  ]) {
    test.concurrent(`bun ${args.join(" ")}`, async () => {
      using dir = tempDir("test-rerun", { "a.test.ts": testFile("v1") });
      await using proc = spawn({
        cmd: [bunExe(), ...args, "--no-clear-screen"],
        cwd: String(dir),
        env: bunEnv,
        stdio: ["ignore", "ignore", "pipe"],
      });

      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      async function waitFor(needle: string, from = 0) {
        while (!buf.slice(from).includes(needle)) {
          const { value, done } = await reader.read();
          if (done) {
            throw new Error(
              `bun exited with code ${await proc.exited} before printing ${JSON.stringify(needle)}. stderr:\n${buf}`,
            );
          }
          buf += decoder.decode(value, { stream: true });
        }
      }

      await waitFor("RAN v1");
      // The summary is printed after the file was loaded, i.e. after it was
      // registered with the watcher, so a write from here on is observed.
      await waitFor("Ran 1 test across 1 file");

      const firstRun = buf.length;
      await writeFile(join(String(dir), "a.test.ts"), testFile("v2"));
      await waitFor("RAN v2", firstRun);
      await waitFor("Ran 1 test across 1 file", firstRun);
      expect(buf.slice(firstRun)).not.toContain("RAN v1");

      reader.releaseLock();
      proc.kill();
      await proc.exited;
    });
  }
});
