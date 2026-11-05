/**
 * These tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) rm tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
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

  // The DirTask parent/child hand-off had a lost-wakeup window between
  // `subtask_count.load() > 1` and `need_to_wait.store(true)`: the last
  // child could decrement and read `need_to_wait == false` in between,
  // stranding the parent DirTask forever. A directory with exactly one
  // subdirectory is the minimal trigger; the window is a few instructions
  // so this is a stress probe rather than a deterministic repro.
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
      const running = ($`rm -rf ${target}`.nothrow().quiet() as any).run();
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
    // The error names "." in the shell cwd, not "/" from the process cwd.
    expect(result.stderr).toMatch(/^rm: \.: /);
    // rm does nothing with ".", so what is in it stays.
    expect(existsSync(path.join(base, "work", "file.txt"))).toBeTrue();
    expect(existsSync(path.join(base, "work", "sub", "inner.txt"))).toBeTrue();
    expect(existsSync(path.join(base, "work"))).toBeTrue();
    expect(existsSync(path.join(base, "keep.txt"))).toBeTrue();
    expect(exitCode).toBe(0);
  },
);

// What is in `dir`: a directory as "name/", a symlink as "name@", a file as "name".
function listTree(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(entry =>
      entry.isDirectory()
        ? [prefix + entry.name + "/", ...listTree(path.join(dir, entry.name), prefix + entry.name + "/")]
        : [prefix + entry.name + (entry.isSymbolicLink() ? "@" : "")],
    )
    .sort();
}

// POSIX: rm writes a diagnostic and does nothing more with an operand whose
// last component is "." or "..". On Linux `rm -r` used to walk such an operand
// and remove what is in it. Only the rmdir of the operand itself failed, after
// that: `rm -rf d/..` emptied the shell cwd and exited 0, `rm -r ..` emptied
// the parent of the shell cwd.
describe.concurrent("rm -r does nothing with an operand that ends in . or ..", () => {
  // The shell cwd is "w". "keep" and "o" are outside it. "d/link" is a symlink
  // to "o/sub": the kernel resolves "d/link/.." to "o", and a join of the two
  // names gives "d".
  function fixture() {
    const dir = tempDir("rm-dot", { keep: "", o: { g: "", sub: { h: "" } }, w: { f: "", d: { g: "" }, e: {} } });
    if (!isWindows) symlinkSync("../../o/sub", path.join(String(dir), "w", "d", "link"));
    return dir;
  }
  const all = ["keep", "o/", "o/g", "o/sub/", "o/sub/h", "w/", "w/d/", "w/d/g", "w/d/link@", "w/e/", "w/f"].filter(
    name => !isWindows || !name.includes("link"),
  );

  async function run(line: string, dir: string) {
    const { stdout, stderr, exitCode } = await $`${{ raw: line }}`.cwd(path.join(dir, "w")).quiet();
    return { left: listTree(dir), stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
  }

  // On Linux the message is the same for every operand. macOS tries an rmdir
  // of a directory operand before the walk, so there the error can be the one
  // of that rmdir, and only the name in it is checked.
  const refused = (operand: string) =>
    isLinux ? `rm: ${operand}: Invalid argument\n` : expect.stringContaining(`rm: ${operand}: `);

  const operands = [
    ".",
    "./",
    ".//",
    "..",
    "../",
    "d/.",
    "d/./",
    "d/..",
    "d/../.",
    "e/.",
    "d/link/.",
    "d/link/..",
  ].filter(operand => !isWindows || !operand.includes("link"));
  const refusals = [
    ...["-r", "-rf", "-rfv"].flatMap(flags => operands.map(operand => ({ line: `rm ${flags} ${operand}`, operand }))),
    { line: "rm -R ..", operand: ".." },
    { line: "rm --recursive d/..", operand: "d/.." },
  ];
  test.each(refusals)("$line", async ({ line, operand }) => {
    using dir = fixture();
    const { left, ...output } = await run(line, String(dir));
    expect(left).toEqual(all);
    // Windows does not resolve "." and ".." in a name (#13523). rm finds no
    // directory there, so it has nothing to refuse and its output is not the same.
    if (!isWindows) expect(output).toEqual({ stdout: "", stderr: refused(operand), exitCode: 1 });
  });

  test("bun exec 'rm -rf d/..'", async () => {
    using dir = fixture();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", "rm -rf d/.."],
      env: bunEnv,
      cwd: path.join(String(dir), "w"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(listTree(String(dir))).toEqual(all);
    // As above: on Windows (#13523) rm has nothing to refuse.
    if (!isWindows) expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: refused("d/.."), exitCode: 1 });
  });

  // `gone` is what the line removes.
  const lines: { line: string; gone: string[]; stderr: unknown; exitCode: number }[] = [
    // A file next to a refused operand is removed, before it and after it.
    { line: "rm -rf d/. f", gone: ["w/f"], stderr: refused("d/."), exitCode: 1 },
    { line: "rm -rf f d/.", gone: ["w/f"], stderr: refused("d/."), exitCode: 1 },
    // The lines below did not change. An operand that does not exist, or is
    // not a directory, keeps its own error.
    { line: "rm -rf missing/.", gone: [], stderr: "", exitCode: 0 },
    { line: "rm -r missing/.", gone: [], stderr: "rm: missing/.: No such file or directory\n", exitCode: 1 },
    { line: "rm -r f/.", gone: [], stderr: "rm: f/.: Not a directory\n", exitCode: 1 },
    // Without -r there is no walk. The error is the one of the unlink or of the rmdir.
    { line: "rm .", gone: [], stderr: "rm: .: Is a directory\n", exitCode: 1 },
    { line: "rm -d e/.", gone: [], stderr: refused("e/."), exitCode: 1 },
    // Only the last component counts.
    { line: "rm -rf e/../d", gone: ["w/d/", "w/d/g", "w/d/link@"], stderr: "", exitCode: 0 },
  ];
  // Windows does not resolve these names (#13523), so its messages are not the same.
  test.skipIf(isWindows).each(lines)("$line", async ({ line, gone, stderr, exitCode }) => {
    using dir = fixture();
    expect(await run(line, String(dir))).toEqual({
      left: all.filter(name => !gone.includes(name)),
      stdout: "",
      stderr,
      exitCode,
    });
  });

  // Windows does not keep a name that ends in a dot, and a backslash separates names there.
  test.skipIf(isWindows)("a name that only looks like . or .. is removed", async () => {
    const names = ["...", "..b", ".hid", "a.", "c..", "x\\.", "y\\.."];
    using dir = tempDir("rm-dot", { keep: "", w: Object.fromEntries(names.map(name => [name, { g: "" }])) });
    const line = `rm -rf ${names.map(name => `'${name}'`).join(" ")}`;
    expect(await run(line, String(dir))).toEqual({ left: ["keep", "w/"], stdout: "", stderr: "", exitCode: 0 });
  });
});

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
