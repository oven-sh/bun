import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isBroken, isLinux, isWindows, tempDir, tempDirWithFiles } from "harness";
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

// When inotify_init1(2) fails with EMFILE (per-uid fs.inotify.max_user_instances
// exhausted), --hot/--watch must print a clean error and exit 1 instead of
// panicking with a crash-report banner and SIGABRT.
describe.skipIf(!isLinux)("inotify instance limit exhausted", () => {
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  let dir: ReturnType<typeof tempDir>;
  let shim: string;

  beforeAll(async () => {
    if (!cc) throw new Error("no C compiler found");
    dir = tempDir("watcher-emfile", {
      "shim.c": `
        #include <errno.h>
        int inotify_init1(int flags) { errno = EMFILE; return -1; }
        int inotify_init(void) { errno = EMFILE; return -1; }
      `,
      "entry.ts": `console.log("alive");`,
      "entry.test.ts": `import { test } from "bun:test"; test("alive", () => console.log("alive"));`,
    });
    shim = join(String(dir), "shim.so");
    await using ccProc = Bun.spawn({
      cmd: [cc, "-shared", "-fPIC", "-o", shim, join(String(dir), "shim.c")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
    if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  });

  afterAll(() => {
    dir?.[Symbol.dispose]();
  });

  test.concurrent.each([
    ["bun --hot", ["--hot", "entry.ts"]],
    ["bun --watch", ["--watch", "entry.ts"]],
    ["bun test --watch", ["test", "--watch", "entry.test.ts"]],
    ["bun build --watch", ["build", "--watch", "entry.ts"]],
  ] as const)("%s exits cleanly with EMFILE instead of panicking", async (_, args) => {
    const existing = bunEnv.LD_PRELOAD;
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: {
        ...bunEnv,
        LD_PRELOAD: existing ? `${shim}:${existing}` : shim,
        // Global::exit(1) runs libc exit() under ASAN; LSAN would report the
        // live bundler/VM state as a "leak" and abort_on_error turns that into
        // SIGABRT. Last option wins.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("EMFILE");
    expect(stderr).toContain("Failed to initialize file watcher");
    expect(stderr).toContain("fs.inotify.max_user_instances");
    expect(stdout).not.toContain("alive");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  });
});
