/**
 * These tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) rm tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import path from "path";
import { createTestBuilder, sortedShellOutput } from "../util";
const TestBuilder = createTestBuilder(import.meta.path);

const fileExists = async (path: string): Promise<boolean> =>
  $`ls -d ${path}`.then(o => o.stdout.toString() === `${path}\n`);

$.nothrow();

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

const BUN = bunExe();
const DEV_NULL = process.platform === "win32" ? "NUL" : "/dev/null";

describe.concurrent("bunshell rm", () => {
  TestBuilder.command`echo ${packagejson()} > package.json; ${BUN} install --linker hoisted &> ${DEV_NULL}; rm -rf node_modules/`
    .ensureTempDir()
    .doesNotExist("node_modules")
    .runAsTest("node_modules");

  test("force", async () => {
    const files = {
      "existent.txt": "",
    };
    await using tempdir = tempDir("rmforce", files);

    expect(await $`rm -f ${tempdir}/non_existent.txt`.then(o => o.exitCode)).toBe(0);

    {
      const { stderr, exitCode } = await $`rm ${tempdir}/non_existent.txt`;
      expect(stderr.toString()).toEqual(`rm: ${tempdir}/non_existent.txt: No such file or directory\n`);
      expect(exitCode).toBe(1);
    }

    {
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeTrue();
      const { stdout, exitCode } = await $`rm -v ${tempdir}/existent.txt`;
      expect(stdout.toString()).toEqual(`${tempdir}/existent.txt\n`);
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeFalse();
    }
  });

  test("recursive", async () => {
    const files = {
      "existent.txt": "",
    };

    await using tempdir = tempDir("rmrecursive", files);

    // test on a file
    {
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeTrue();
      const { stdout, stderr, exitCode } = await $`rm -rv ${tempdir}/existent.txt`;
      expect(stderr.length).toBe(0);
      expect(stdout.toString()).toEqual(`${tempdir}/existent.txt\n`);
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeFalse();
    }

    // test on a directory
    {
      let subDir = path.join(tempdir, "folder", "sub");
      mkdirSync(subDir, { recursive: true });
      let subFile = path.join(subDir, "file.txt");
      writeFileSync(subFile, "test");
      const { stdout, exitCode } = await $`rm -rv ${path.join(tempdir, "folder")}`;
      expect(sortedShellOutput(stdout.toString())).toEqual(
        sortedShellOutput(`${subFile}\n${subDir}\n${path.join(tempdir, "folder")}\n`),
      );
      expect(exitCode).toBe(0);

      expect(await fileExists(subDir)).toBeFalse();
      expect(await fileExists(subFile)).toBeFalse();
      {
        const { stdout, stderr, exitCode } = await $`ls ${tempdir}`;
        console.log("NICE", stdout.toString(), exitCode);
        console.log("NICE", stderr.toString());
      }
      expect(await fileExists(tempdir)).toBeTrue();
    }

    // test with cwd
    {
      const tmpdir = TestBuilder.tmpdir();
      const { stdout, stderr } =
        await $`mkdir foo; touch ./foo/lol ./foo/nice ./foo/lmao; mkdir foo/bar; touch ./foo/bar/great; touch ./foo/bar/wow; rm -rfv foo/`.cwd(
          tmpdir,
        );
      expect(sortedShellOutput(stdout.toString())).toEqual(
        sortedShellOutput(
          `foo/lol
foo/nice
foo/lmao
foo/bar
foo/bar/great
foo/bar/wow
foo/
`,
        ),
      );
    }
  });

  test("dir", async () => {
    const files = {
      "existent.txt": "",
      "sub_dir": {},
      "sub_dir_files/file.txt": "",
    };

    await using tempdir = tempDir("rmdir", files);

    {
      const { stdout, stderr, exitCode } = await $`rm -d ${tempdir}/existent.txt`;
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/existent.txt`)).toBeFalse();
    }

    {
      const { stdout, stderr, exitCode } = await $`rm -d ${tempdir}/sub_dir`;
      console.log(stderr.toString());
      expect(exitCode).toBe(0);
      expect(await fileExists(`${tempdir}/sub_dir`)).toBeFalse();
    }

    {
      const { stdout, stderr, exitCode } = await $`rm -d ${tempdir}/sub_dir_files`;
      console.log(exitCode, "STDOUT", stdout.toString());
      expect(stderr.toString()).toEqual(`rm: ${tempdir}/sub_dir_files: Directory not empty\n`);
      expect(exitCode).toBe(1);
      expect(await fileExists(`${tempdir}/sub_dir_files`)).toBeTrue();
    }
  });

  // Every directory, including an empty one, is removed by whichever thread
  // drops its last `subtask_count` after its walk has returned, and reports
  // itself once; files are reported by the directory walk that unlinked them.
  test.each([
    ["-rv", true],
    ["-r", false],
  ])("recursive rm %s removes a tree of nested, empty and leaf directories", async (flag, verbose) => {
    using tempdir = tempDir("rm-tree", {
      "tree/f0": "",
      "tree/f1": "",
      "tree/empty": {},
      "tree/a/f": "",
      "tree/a/empty": {},
      "tree/a/b/f": "",
      "tree/a/b/c/f": "",
      "tree/a/b/c/g": "",
      "tree/a/b/c/d": {},
      "tree/x/f": "",
      "tree/y/z/f": "",
    });
    const root = path.join(String(tempdir), "tree");
    const entries = [
      "",
      "f0",
      "f1",
      "empty",
      "a",
      "a/f",
      "a/empty",
      "a/b",
      "a/b/f",
      "a/b/c",
      "a/b/c/f",
      "a/b/c/g",
      "a/b/c/d",
      "x",
      "x/f",
      "y",
      "y/z",
      "y/z/f",
    ].map(rel => path.join(root, rel));

    const { stdout, stderr, exitCode } = await $`rm ${flag} ${root}`;
    expect({
      stdout: sortedShellOutput(stdout.toString()),
      stderr: stderr.toString(),
      exitCode,
      remains: existsSync(root),
    }).toEqual({
      stdout: verbose ? entries.sort() : [],
      stderr: "",
      exitCode: 0,
      remains: false,
    });
  });

  // A directory's walk (`DirTask::drop_own_count`) and its last child
  // (`DirTask::post_run`) race to drop the directory's final `subtask_count`;
  // whichever wins has to remove the directory, or the rm never resolves
  // (#34032 was a lost wakeup in an earlier, load-then-store version of this
  // hand-off). A directory with exactly one subdirectory is the minimal
  // trigger; the window is a few instructions wide, so this is a stress probe
  // rather than a deterministic repro.
  test("recursive rm never hangs on the DirTask hand-off", async () => {
    using base = tempDir("rm-handoff", {});
    const fixture = /* ts */ `
      import { $ } from "bun";
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      const base = ${JSON.stringify(String(base))};

      function tree(n: number): string {
        const d = join(base, "t" + n);
        mkdirSync(join(d, "foo", "bar"), { recursive: true });
        writeFileSync(join(d, "foo", "a"), "");
        writeFileSync(join(d, "foo", "bar", "b"), "");
        return d;
      }

      const ITERS = 100;
      const PAR = 8;
      for (let it = 0; it < ITERS; it++) {
        const dirs = Array.from({ length: PAR }, (_, i) => tree(it * PAR + i));
        let watchdogTimer!: ReturnType<typeof setTimeout>;
        const watchdog = new Promise<"hang">(r => (watchdogTimer = setTimeout(() => r("hang"), 10_000)));
        const results = await Promise.all(
          dirs.map(d =>
            Promise.race([
              $\`rm -rfv \${d}/foo\`.quiet().nothrow().then(r => r.exitCode),
              watchdog,
            ]),
          ),
        );
        clearTimeout(watchdogTimer);
        for (const r of results) {
          if (r === "hang") {
            console.error("rm -rfv hung at iteration", it);
            process.exit(1);
          }
          if (r !== 0) {
            console.error("rm -rfv exited", r, "at iteration", it);
            process.exit(1);
          }
        }
      }
      console.log("ok", ITERS * PAR);
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({
      stdout: "ok 800",
      stderr: "",
    });
    expect(exitCode).toBe(0);
  }, 120_000);
});

function packagejson() {
  return `{
  "name": "dummy",
  "dependencies": {
    "@biomejs/biome": "^1.5.3",
    "@vscode/debugadapter": "^1.61.0",
    "esbuild": "^0.17.15",
    "eslint": "^8.20.0",
    "eslint-config-prettier": "^8.5.0",
    "mitata": "^0.1.3",
    "peechy": "0.4.34",
    "prettier": "3.2.2",
    "react": "next",
    "react-dom": "next",
    "source-map-js": "^1.0.2",
    "typescript": "^5.0.2"
  },
  "devDependencies": {
    "@types/react": "^18.0.25",
    "@typescript-eslint/eslint-plugin": "^5.31.0",
    "@typescript-eslint/parser": "^5.31.0"
  },
  "version": "0.0.0"
}`;
}

// Recursive `rm -rf` classifies each entry as a directory from readdir, then
// later re-opens it by path on a worker thread. If that path is replaced by a
// symlink between classification and open, the open must not follow the link
// into an unrelated tree. Each iteration races a batch of directory->symlink
// swaps against the walker; the file behind the symlink must survive every
// time. The legitimate case (real directories that are not swapped in time)
// is exercised by the same loop: those entries are simply deleted.
test.skipIf(process.platform === "win32")(
  "recursive rm does not follow a directory entry replaced by a symlink during deletion",
  async () => {
    const ENTRIES = 64;
    const FILLER = 8;
    const ITERATIONS = 10;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const files: Record<string, string> = {
        "victim/keep.txt": "important",
        "stash/.keep": "",
      };
      for (let i = 0; i < ENTRIES; i++) {
        for (let j = 0; j < FILLER; j++) {
          files[`target/d${i}/f${j}.txt`] = "";
        }
      }
      await using root = tempDir(`rm-swap-${iter}`, files);
      const victimDir = path.join(root, "victim");
      const victimFile = path.join(victimDir, "keep.txt");
      const target = path.join(root, "target");

      // Start the recursive delete on the worker pool, then immediately
      // replace each subdirectory with a symlink pointing at the victim
      // directory while the walk is in flight.
      const running = $`rm -rf ${target}`.nothrow().quiet().run();
      for (let i = 0; i < ENTRIES; i++) {
        const entry = path.join(target, `d${i}`);
        try {
          renameSync(entry, path.join(root, "stash", `d${i}`));
          symlinkSync(victimDir, entry);
        } catch {
          // The walker may have already deleted this entry; that's fine.
        }
      }
      await running;

      // The contents of the directory behind the symlink must never be
      // deleted, no matter when the swap landed relative to the walk.
      expect(existsSync(victimFile)).toBeTrue();
      expect(existsSync(victimDir)).toBeTrue();
    }
  },
);

// The recursive walk joined every entry onto its directory's path inside a
// fixed-size path buffer on the worker thread, so a tree deeper than PATH_MAX
// aborted the whole process instead of failing that entry. Files and
// directories take different joins, so one tree of each. Runs in a child
// process so the abort shows up as a failed assertion. Windows has a
// different path limit, and its shell rm is bounded differently.
test.skipIf(process.platform === "win32")(
  "recursive rm reports an entry deeper than PATH_MAX instead of crashing",
  async () => {
    // Linux PATH_MAX is 4096, every other POSIX platform Bun runs on has 1024.
    const PATH_MAX = process.platform === "linux" ? 4096 : 1024;
    using base = tempDir("rm-deep-walk", {});
    const fixture = /* ts */ `
      import { $ } from "bun";
      import { existsSync, mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      $.nothrow();

      const base = process.env.BASE!;
      // Long enough that a 100 byte entry inside the directory is past
      // PATH_MAX, short enough that the directory itself is still well inside.
      const deepLength = Number(process.env.PATH_MAX) - 64;
      const component = Buffer.alloc(100, "d").toString();
      // <base>/<tag>/ddd.../ddd... with an absolute path of deepLength bytes.
      function deepDir(tag: string): string {
        let dir = join(base, tag);
        while (Buffer.byteLength(dir) + 1 + component.length <= deepLength) dir = join(dir, component);
        const rest = deepLength - Buffer.byteLength(dir) - 1;
        if (rest > 0) dir = join(dir, Buffer.alloc(rest, "e").toString());
        mkdirSync(dir, { recursive: true });
        return dir;
      }

      // An entry whose full path is longer than PATH_MAX can only be created
      // relative to its directory.
      const fileDir = deepDir("file");
      const fileName = Buffer.alloc(100, "f").toString();
      process.chdir(fileDir);
      writeFileSync(fileName, "");

      const dirDir = deepDir("dir");
      const dirName = Buffer.alloc(100, "s").toString();
      process.chdir(dirDir);
      mkdirSync(dirName);

      process.chdir(base);
      mkdirSync(join(base, "plain", "sub"), { recursive: true });

      const run = async (operand: string) => {
        const { exitCode, stderr } = await $\`rm -rf \${operand}\`.cwd(base).quiet();
        return { exitCode, stderr: stderr.toString() };
      };
      console.log(
        JSON.stringify({
          file: { ...(await run(join(base, "file"))), entry: join(fileDir, fileName), dirKept: existsSync(fileDir) },
          dir: { ...(await run(join(base, "dir"))), entry: join(dirDir, dirName), dirKept: existsSync(dirDir) },
          plain: { ...(await run(join(base, "plain"))), removed: !existsSync(join(base, "plain")) },
        }),
      );
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BASE: String(base), PATH_MAX: String(PATH_MAX) },
      cwd: String(base),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const results = JSON.parse(stdout);
    // The entries are what rm could not remove, and this is why: a path of
    // PATH_MAX bytes has no room left for its NUL.
    expect(Buffer.byteLength(results.file.entry)).toBeGreaterThanOrEqual(PATH_MAX);
    expect(Buffer.byteLength(results.dir.entry)).toBeGreaterThanOrEqual(PATH_MAX);
    expect(results).toEqual({
      file: {
        exitCode: 1,
        stderr: `rm: ${results.file.entry}: File name too long\n`,
        entry: expect.stringMatching(/\/f{100}$/),
        dirKept: true,
      },
      dir: {
        exitCode: 1,
        stderr: `rm: ${results.dir.entry}: File name too long\n`,
        entry: expect.stringMatching(/\/s{100}$/),
        dirKept: true,
      },
      plain: { exitCode: 0, stderr: "", removed: true },
    });
    expect(exitCode).toBe(0);
  },
);

test.skipIf(process.platform === "win32")(
  "relative operands are resolved against the shell cwd, not the process cwd",
  async () => {
    using dir = tempDir("rm-shell-cwd", {
      "work/file.txt": "content",
      "work/sub/inner.txt": "content",
      "keep.txt": "keep",
    });
    const base = String(dir);
    const shellCwd = path.join(base, "work");

    const fixture = /* ts */ `
      import { $ } from "bun";
      const shellCwd = process.env.SHELL_CWD!;
      const { exitCode, stderr } = await $\`rm -rf .\`.cwd(shellCwd).quiet().nothrow();
      console.log(JSON.stringify({ exitCode, stderr: stderr.toString() }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, SHELL_CWD: shellCwd },
      cwd: "/",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = JSON.parse(stdout.trim());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^rm: \.: /);
    if (process.platform === "linux") {
      // Only Linux permits unlinking "." out from under itself; macOS returns
      // before iterating, so its children survive there.
      expect(existsSync(path.join(base, "work", "file.txt"))).toBeFalse();
      expect(existsSync(path.join(base, "work", "sub"))).toBeFalse();
    }
    expect(existsSync(path.join(base, "work"))).toBeTrue();
    expect(existsSync(path.join(base, "keep.txt"))).toBeTrue();
    expect(exitCode).toBe(0);
  },
);

// The preserve-root check resolved every operand through the fixed-size
// thread-local path buffers (1024 bytes for normalizing, 4096 for joining),
// so an operand longer than either crashed the process before rm ever
// touched the filesystem. Runs in a child process so the crash shows up as a
// failed assertion rather than taking the test runner down with it.
test("operands longer than the path scratch buffers are reported, not a crash", async () => {
  using dir = tempDir("rm-long-operand", { "short.txt": "" });
  const long = Buffer.alloc(1100, "a").toString();
  const longer = Buffer.alloc(8192, "b").toString();
  const absolute = path.join(String(dir), long);
  // Joins back down to "/" no matter how long it is, so it still has to be refused.
  const upToRoot = Buffer.alloc(6000, "../").toString();

  const fixture = /* ts */ `
    import { $ } from "bun";
    import { existsSync } from "node:fs";
    $.nothrow();
    const { LONG, LONGER, ABSOLUTE, UP_TO_ROOT } = process.env;
    const run = async (...args: string[]) => {
      const { exitCode, stderr } = await $\`rm \${args}\`.quiet();
      return { exitCode, stderr: stderr.toString() };
    };
    const results = {
      relative: await run(LONG!),
      absolute: await run(ABSOLUTE!),
      overJoinBuffer: await run(LONGER!),
      mixed: { ...(await run(LONG!, "short.txt")), shortRemoved: !existsSync("short.txt") },
      upToRoot: UP_TO_ROOT ? await run(UP_TO_ROOT) : undefined,
    };
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      LONG: long,
      LONGER: longer,
      ABSOLUTE: absolute,
      // The check is effectively a no-op for drive-rooted paths on Windows.
      ...(isWindows ? {} : { UP_TO_ROOT: upToRoot }),
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  // Which errno an over-long name produces is up to the OS; what matters is
  // that each operand fails on its own and the others are still processed.
  const tooLong = (operand: string) =>
    isWindows ? expect.stringMatching(/^rm: /) : `rm: ${operand}: File name too long\n`;
  expect(JSON.parse(stdout)).toEqual({
    relative: { exitCode: 1, stderr: tooLong(long) },
    absolute: { exitCode: 1, stderr: tooLong(absolute) },
    overJoinBuffer: { exitCode: 1, stderr: tooLong(longer) },
    mixed: { exitCode: 1, stderr: tooLong(long), shortRemoved: true },
    ...(isWindows ? {} : { upToRoot: { exitCode: 1, stderr: 'rm: "/" may not be removed\n' } }),
  });
  expect(exitCode).toBe(0);
});
