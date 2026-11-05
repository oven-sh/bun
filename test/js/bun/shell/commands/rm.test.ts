/**
 * These tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) rm tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
    // The error names "." in the shell cwd, not "/". rm refuses "." and removes nothing of it.
    expect(result.stderr).toBe("rm: .: Invalid argument\n");
    expect(existsSync(path.join(base, "work", "file.txt"))).toBeTrue();
    expect(existsSync(path.join(base, "work", "sub", "inner.txt"))).toBeTrue();
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

// A name that ends in "/" is a directory, "name -> target" is a symlink, any other name is a file.
function makeTree(dir: string, names: string[]) {
  for (const name of names) {
    const [link, target] = name.split(" -> ");
    const full = path.join(dir, link);
    mkdirSync(path.dirname(full), { recursive: true });
    if (target !== undefined) symlinkSync(target, full);
    else if (name.endsWith("/")) mkdirSync(full, { recursive: true });
    else writeFileSync(full, name);
  }
}

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

// What one run left in `dir`. The files that the line redirects to are not part of the tree.
function leftIn(dir: string) {
  const files: Record<string, string> = {};
  for (const name of ["out.txt", "err.txt"]) {
    if (existsSync(path.join(dir, name))) files[name] = readFileSync(path.join(dir, name), "utf8");
  }
  return { left: listTree(dir).filter(name => !(name in files)), files };
}

const missing = (operand: string) => `rm: ${operand}: No such file or directory\n`;
const refused = (operand: string) => `rm: ${operand}: Invalid argument\n`;
const numbered = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => prefix + String(i).padStart(3, "0"));
// A directory operand with files and subdirectories, and the lines that -v prints for it.
const tree = (operand: string) => ["x", "s1/y", "s1/t/z", "s2/y", "s3/"].map(name => `${operand}/${name}`);
const treeLines = (operand: string) =>
  ["", "/x", "/s1", "/s1/y", "/s1/t", "/s1/t/z", "/s2", "/s2/y", "/s3"].map(name => operand + name);
// A directory operand whose walk takes a while.
const bushy = (operand: string) =>
  [0, 1, 2, 3].flatMap(s => [0, 1, 2, 3, 4, 5].map(f => `${operand}/s${s}/f${f}`)).concat(`${operand}/f0`);
const bushes = (...operands: string[]) => operands.flatMap(bushy);

// GNU rm takes its operands one after another, in the order given, and goes
// on to the next operand after one fails. Every operand used to start on the
// thread pool at once. With one operand inside another, the exit code and the
// files left over changed from run to run, and the first error in any operand
// stopped the walks of all the others.
describe.concurrent("rm takes its operands in the order given", () => {
  type Case = {
    line: string;
    setup: string[];
    exitCode: number;
    left: string[];
    stdout?: string;
    stderr?: string;
    // What the line redirects to, by name.
    files?: Record<string, string>;
  };
  const cases: Case[] = [
    { line: "rm -d a/b a", setup: ["a/b/"], exitCode: 0, left: [] },
    { line: "rm -d a a/b", setup: ["a/b/"], exitCode: 1, left: ["a/"], stderr: "rm: a: Directory not empty\n" },
    { line: "rm -r a a/b", setup: ["a/b/k"], exitCode: 1, left: [], stderr: missing("a/b") },
    { line: "rm -r a/b a", setup: ["a/b/k"], exitCode: 0, left: [] },
    { line: "rm -rf a/b a", setup: ["a/b/k"], exitCode: 0, left: [] },
    { line: "rm -rf a a/b", setup: ["a/b/k"], exitCode: 0, left: [] },
    { line: "rm -rf a a", setup: ["a/b/k"], exitCode: 0, left: [] },
    { line: "rm -d a/b/c/d a/b/c a/b a", setup: ["a/b/c/d/"], exitCode: 0, left: [] },
    { line: "rm -r a/b/c a/b a", setup: ["a/b/c/k"], exitCode: 0, left: [] },
    {
      line: "rm -d 1/2/3/4/5/6/7/8 1/2/3/4/5/6/7 1/2/3/4/5/6 1/2/3/4/5 1/2/3/4 1/2/3 1/2 1",
      setup: ["1/2/3/4/5/6/7/8/"],
      exitCode: 0,
      left: [],
    },
    // The second operand no longer resolves. With -f that is no error, and a/c stays.
    { line: "rm -rf a/b a/b/../c", setup: ["a/b/k", "a/c/k"], exitCode: 0, left: ["a/", "a/c/", "a/c/k"] },
    // An operand that fails does not stop a later operand.
    { line: "rm -r missing a", setup: ["a/x", "a/sub/y"], exitCode: 1, left: [], stderr: missing("missing") },
    // The walk of a tree most often ends on another thread, which has to go on with the next operand.
    {
      line: "rm -r a b missing c",
      setup: ["a", "b", "c"].flatMap(tree),
      exitCode: 1,
      left: [],
      stderr: missing("missing"),
    },
    // One error line for each operand that fails, in operand order.
    {
      line: `rm ${numbered("missing", 12).join(" ")}`,
      setup: [],
      exitCode: 1,
      left: [],
      stderr: numbered("missing", 12).map(missing).join(""),
    },
    // -v lists what was removed operand by operand.
    {
      line: `rm -v ${numbered("file", 12).join(" ")}`,
      setup: numbered("file", 12),
      exitCode: 0,
      left: [],
      stdout: numbered("file", 12).join("\n") + "\n",
    },
    { line: "rm -rv a/b a", setup: ["a/b/k"], exitCode: 0, left: [], stdout: "a/b/k\na/b\na\n" },
    // With both streams in one writer, an error line stands between the -v lines of the operands around it.
    {
      line: "rm -v before missing after 2>&1",
      setup: ["before", "after"],
      exitCode: 1,
      left: [],
      stdout: `before\n${missing("missing")}after\n`,
    },
    {
      line: "rm -v before missing after &> out.txt",
      setup: ["before", "after"],
      exitCode: 1,
      left: [],
      files: { "out.txt": `before\n${missing("missing")}after\n` },
    },
    // stderr is a file: the command ends when its last chunk is written.
    { line: "rm missing 2> err.txt", setup: [], exitCode: 1, left: [], files: { "err.txt": missing("missing") } },
    {
      line: "rm -r a missing 2> err.txt",
      setup: ["a/x"],
      exitCode: 1,
      left: [],
      files: { "err.txt": missing("missing") },
    },
    // rm refuses "." and "..", as POSIX says, also after an operand that failed.
    {
      line: "rm -r missing .",
      setup: ["a/x", "b/y"],
      exitCode: 1,
      left: ["a/", "a/x", "b/", "b/y"],
      stderr: missing("missing") + refused("."),
    },
    { line: "rm -rf a/. b", setup: ["a/x", "b/y"], exitCode: 1, left: ["a/", "a/x"], stderr: refused("a/.") },
    { line: "rm -rf a/.. b", setup: ["a/x", "b/y"], exitCode: 1, left: ["a/", "a/x"], stderr: refused("a/..") },
    // Operands that cover each other through a symlink. A test on Windows cannot make one.
    ...(isWindows
      ? []
      : [
          { line: "rm -r link/sub a", setup: ["a/sub/k", "link -> a"], exitCode: 0, left: ["link@"] },
          {
            line: "rm -r a link/sub",
            setup: ["a/sub/k", "link -> a"],
            exitCode: 1,
            left: ["link@"],
            stderr: missing("link/sub"),
          },
          { line: "rm -rf link/sub link", setup: ["a/sub/k", "link -> a"], exitCode: 0, left: ["a/"] },
        ]),
    // rm refuses "." only where it exists: a missing operand is a missing operand.
    { line: "rm -rf missing/. b", setup: ["b/y"], exitCode: 0, left: [] },
    { line: "rm -r missing/. b", setup: ["b/y"], exitCode: 1, left: [], stderr: missing("missing/.") },
    // Directory operands whose walks would overlap if they started at once.
    { line: "rm -r a b c", setup: bushes("a", "b", "c"), exitCode: 0, left: [] },
    { line: "rm -r a b a/s1", setup: bushes("a", "b"), exitCode: 1, left: [], stderr: missing("a/s1") },
    { line: "rm -r a/s1 a b", setup: bushes("a", "b"), exitCode: 0, left: [] },
    { line: "rm -r a b a", setup: bushes("a", "b"), exitCode: 1, left: [], stderr: missing("a") },
    { line: "rm -rf a b a", setup: bushes("a", "b"), exitCode: 0, left: [] },
    { line: "rm -r p/a p/b p", setup: bushes("p/a", "p/b"), exitCode: 0, left: [] },
    { line: "rm -r p/q/a p/q/b p", setup: bushes("p/q/a", "p/q/b"), exitCode: 0, left: [] },
    { line: "rm -r p/a b p/a/s1", setup: bushes("p/a", "b"), exitCode: 1, left: ["p/"], stderr: missing("p/a/s1") },
    {
      line: "rm -r p p/a p/b",
      setup: bushes("p/a", "p/b"),
      exitCode: 1,
      left: [],
      stderr: missing("p/a") + missing("p/b"),
    },
    { line: "rm -r a b ./a c", setup: bushes("a", "b", "c"), exitCode: 1, left: [], stderr: missing("./a") },
    { line: "rm -r a b a/s0/f1 c", setup: bushes("a", "b", "c"), exitCode: 1, left: [], stderr: missing("a/s0/f1") },
    { line: "rm -r a b b/../a", setup: bushes("a", "b"), exitCode: 1, left: [], stderr: missing("b/../a") },
    {
      line: "rm -r a b s/../c c/s1 d e",
      setup: [...bushes("a", "b", "c", "d", "e"), "s/"],
      exitCode: 1,
      left: ["s/"],
      stderr: missing("c/s1"),
    },
    { line: "rm -rf a/ b/ a/ c/", setup: bushes("a", "b", "c"), exitCode: 0, left: [] },
    { line: "rm -rf a f b g c", setup: [...bushes("a", "b", "c"), "f", "g"], exitCode: 0, left: [] },
    { line: "rm -r a f a/f0 b", setup: [...bushes("a", "b"), "f"], exitCode: 1, left: [], stderr: missing("a/f0") },
    // The shell expands the glob: each nested match is an operand inside an operand.
    {
      line: "rm -rf **/node_modules",
      setup: bushes(
        "node_modules",
        "node_modules/a/node_modules",
        "pkg/x/node_modules",
        "pkg/x/node_modules/c/node_modules",
        "pkg/y/node_modules",
      ),
      exitCode: 0,
      left: ["pkg/", "pkg/x/", "pkg/y/"],
    },
    {
      line: "rm -rf packages/*/dist",
      setup: bushes(...numbered("packages/p", 8).map(name => `${name}/dist`)),
      exitCode: 0,
      left: ["packages/", ...numbered("packages/p", 8).map(name => `${name}/`)],
    },
    // Two spellings of one directory, on a file system that ignores case (macOS, Windows).
    { line: "rm -r Dist dist", setup: bushes("Dist"), exitCode: 1, left: [], stderr: missing("dist") },
    { line: "rm -rf Dist dist", setup: bushes("Dist"), exitCode: 0, left: [] },
    // Error lines come in operand order, also between operands that take a while.
    {
      line: "rm -r a missing b c missing2 d",
      setup: bushes("a", "b", "c", "d"),
      exitCode: 1,
      left: [],
      stderr: missing("missing") + missing("missing2"),
    },
    {
      line: "rm -r a missing b c missing2 d 2> err.txt",
      setup: bushes("a", "b", "c", "d"),
      exitCode: 1,
      left: [],
      files: { "err.txt": missing("missing") + missing("missing2") },
    },
    ...(isWindows
      ? []
      : [
          { line: "rm -r a link b", setup: [...bushes("a", "b"), "link -> a"], exitCode: 0, left: [] },
          {
            line: "rm -r a b link/s2",
            setup: [...bushes("a", "b"), "link -> a"],
            exitCode: 1,
            left: ["link@"],
            stderr: missing("link/s2"),
          },
          { line: "rm -r link/s2 a b", setup: [...bushes("a", "b"), "link -> a"], exitCode: 0, left: ["link@"] },
          // An absolute operand between relative ones, and before one that is inside it.
          {
            line: "rm -r a b $PWD/c c/s1 d e",
            setup: bushes("a", "b", "c", "d", "e"),
            exitCode: 1,
            left: [],
            stderr: missing("c/s1"),
          },
          { line: "rm -r $PWD/a a b", setup: bushes("a", "b"), exitCode: 1, left: [], stderr: missing("a") },
        ]),
  ];

  test.each(cases)("$line", async ({ line, setup, ...expected }) => {
    using base = tempDir("rm-operand-order", {});
    const results = new Set<string>();
    for (let round = 0; round < 6; round++) {
      const dir = path.join(String(base), String(round));
      mkdirSync(dir);
      makeTree(dir, setup);
      const { exitCode, stdout, stderr } = await $`${{ raw: line }}`.cwd(dir).quiet().nothrow();
      results.add(JSON.stringify({ exitCode, stdout: stdout.toString(), stderr: stderr.toString(), ...leftIn(dir) }));
    }
    // Every round gives the one result.
    expect([...results].map(result => JSON.parse(result))).toEqual([
      { stdout: "", stderr: "", files: {}, ...expected },
    ]);
  });

  // `bun exec` runs the shell on its own event loop, with stdout and stderr as pipes.
  test.each([
    { threads: "as many threads as cores", env: bunEnv },
    { threads: "2 threads", env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" } },
  ])("through bun exec, with $threads in the pool", async ({ env }) => {
    using base = tempDir("rm-operand-order-exec", {});
    const rounds = cases.flatMap((expected, index) =>
      [0, 1].map(round => ({ ...expected, dir: path.join(String(base), `${index}-${round}`) })),
    );
    for (const { dir, setup } of rounds) {
      mkdirSync(dir);
      makeTree(dir, setup);
    }
    const script = rounds
      .map(({ dir, line }) => `cd "${dir.replaceAll("\\", "/")}" && ${line} && echo ok || echo failed`)
      .join("\n");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", script],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, left: rounds.map(({ dir }) => leftIn(dir)) }).toEqual({
      stdout: rounds
        .map(expected => (expected.stdout ?? "") + (expected.exitCode === 0 ? "ok\n" : "failed\n"))
        .join(""),
      stderr: rounds.map(expected => expected.stderr ?? "").join(""),
      left: rounds.map(expected => ({ left: expected.left, files: expected.files ?? {} })),
    });
    expect(exitCode).toBe(0);
  });

  // The -v lines of file operands wait in one buffer. They have to go out before the lines of a
  // tree's subdirectories, before an error line, and when the buffer is large.
  test.each([
    { redirect: "", streams: "buffers" },
    { redirect: " &> out.txt", streams: "a file" },
  ])("-v lines of many operands, output to $streams", async ({ redirect }) => {
    using base = tempDir("rm-operand-verbose", {});
    const files = numbered("file-" + Buffer.alloc(64, "x").toString(), 80);
    const groups: [name: string, operands: string[], setup: string[], lines: string[]][] = [
      ["f", files, files, files],
      ["a", ["a"], tree("a"), treeLines("a")],
      ["g", numbered("g", 10), numbered("g", 10), numbered("g", 10)],
      ["b", ["b"], tree("b"), treeLines("b")],
      ["r", ["missing"], [], redirect ? [missing("missing").trimEnd()] : []],
      ["h", numbered("h", 5), numbered("h", 5), numbered("h", 5)],
      ["c", ["c"], tree("c"), treeLines("c")],
    ];
    const line = `rm -rv ${groups.flatMap(([, operands]) => operands).join(" ")}${redirect}`;
    const run = async (round: number) => {
      const dir = path.join(String(base), String(round));
      mkdirSync(dir);
      makeTree(
        dir,
        groups.flatMap(([, , setup]) => setup),
      );
      const result = await $`${{ raw: line }}`.cwd(dir).quiet().nothrow();
      const { left, files } = leftIn(dir);
      // Windows joins the directories of the walk with "\\".
      const lines = (redirect ? files["out.txt"] : result.stdout.toString())
        .replaceAll("\\", "/")
        .split("\n")
        .filter(Boolean);
      return {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        left,
        // The first byte of each line names its group of operands: the groups come in operand order.
        order: lines.map(line => line[0]).join(""),
        // A tree's lines come in any order, its own name last.
        lines: groups.map(([name, operands]) => {
          const own = lines.filter(line => line[0] === name);
          return operands.length === 1 ? [...own.slice(0, -1).sort(), ...own.slice(-1)] : own;
        }),
      };
    };
    const expected = {
      exitCode: 1,
      stderr: redirect ? "" : missing("missing"),
      left: [],
      order: groups.map(([name, , , lines]) => name.repeat(lines.length)).join(""),
      lines: groups.map(([, operands, , lines]) =>
        operands.length === 1 ? [...lines.slice(1).sort(), ...lines.slice(0, 1)] : lines,
      ),
    };
    for (let batch = 0; batch < 2; batch++) {
      const results = await Promise.all(Array.from({ length: 2 }, (_, i) => run(batch * 2 + i)));
      for (const result of results) expect(result).toEqual(expected);
    }
  });

  test("several thousand operands", async () => {
    using dir = tempDir("rm-many-operands", {});
    const files = numbered("file", 1500);
    makeTree(String(dir), files);
    // Every second operand fails.
    const operands = files.flatMap((file, i) => [file, `missing${i}`]);
    const { exitCode, stdout, stderr } = await $`rm -v ${operands}`.cwd(String(dir)).quiet().nothrow();
    expect(stdout.toString()).toBe(files.join("\n") + "\n");
    expect(stderr.toString()).toBe(files.map((_, i) => missing(`missing${i}`)).join(""));
    expect(listTree(String(dir))).toEqual([]);
    expect(exitCode).toBe(1);
  });

  // One command with all its operands has to end like one command for each operand, in order.
  test("random operands end like one rm for each operand", async () => {
    using base = tempDir("rm-operand-random", {});
    let seed = 0x2f6e2b1;
    const random = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * n;
    const pick = <T>(list: T[]) => list[Math.floor(random(list.length))];
    const failed = "an-operand-failed";
    const rounds = Array.from({ length: 32 }, (_, round) => {
      const dirs: string[] = [];
      const files: string[] = [];
      const grow = (prefix: string, depth: number) => {
        for (let i = depth === 0 ? 2 + Math.floor(random(4)) : Math.floor(random(4)); i > 0; i--) {
          dirs.push(`${prefix}d${i}`);
          if (depth < 3 && random(1) < 0.6) grow(`${prefix}d${i}/`, depth + 1);
        }
        // Enough files in some directories that walks would overlap if operands started at once.
        for (let i = Math.floor(random(3)) * (random(1) < 0.5 ? 1 : 8); i > 0; i--) files.push(`${prefix}f${i}`);
      };
      grow("", 0);
      const link = !isWindows && random(1) < 0.35 ? pick(dirs) : undefined;
      const setup = [...dirs.map(dir => dir + "/"), ...files, ...(link ? [`link -> ${link}`] : [])];
      // Mostly directories.
      const pool = [...dirs, ...dirs, ...files.filter(() => random(1) < 0.3), "missing1", "missing2"];
      for (const dir of dirs) {
        if (random(1) < 0.15) pool.push("./" + dir);
        if (random(1) < 0.1) pool.push(dir + "/");
        if (random(1) < 0.1) pool.push(`${dir}/../${pick(dirs).split("/")[0]}`);
        if (random(1) < 0.05) pool.push(dir + "/.");
      }
      // Another spelling of what is below the target of the link.
      if (link)
        pool.push(
          "link",
          "link/",
          ...[...dirs, ...files]
            .filter(name => name.startsWith(link + "/"))
            .map(name => "link" + name.slice(link.length)),
        );
      const operands: string[] = [];
      for (let i = 2 + Math.floor(random(9)); i > 0; i--) {
        operands.push(operands.length > 0 && random(1) < 0.12 ? pick(operands) : pick(pool));
      }
      const rm = "rm " + pick(["-r ", "-r ", "-r ", "-rf ", "-rf ", "-rf ", "-rv ", "-rfv ", "-d ", "", "-f ", "-v "]);
      return { round, setup, operands, rm };
    });

    const run = async (name: string, setup: string[], script: string) => {
      const dir = path.join(String(base), name);
      mkdirSync(dir);
      makeTree(dir, setup);
      const { exitCode, stdout, stderr } = await $`${{ raw: script }}`.cwd(dir).quiet().nothrow();
      const lines = stdout.toString().split("\n").filter(Boolean);
      return {
        failed: exitCode !== 0 || lines.includes(failed),
        // The lines of one tree come in any order.
        removed: lines.filter(line => line !== failed).sort(),
        stderr: stderr.toString(),
        left: listTree(dir),
      };
    };
    for (let batch = 0; batch < rounds.length; batch += 4) {
      const results = await Promise.all(
        rounds.slice(batch, batch + 4).map(async ({ round, setup, operands, rm }) => ({
          line: rm + operands.join(" "),
          setup,
          all: await run(`${round}-all`, setup, rm + operands.join(" ")),
          each: await run(
            `${round}-each`,
            setup,
            operands.map(operand => `${rm}${operand} || echo "${failed}"`).join("\n"),
          ),
        })),
      );
      for (const { line, setup, all, each } of results) {
        expect({ line, setup, ...all }).toEqual({ line, setup, ...each });
      }
    }
  });
});

// A mode bit stops the owner of a file only. Where the tests run as root, the shell of these tests
// runs as another user, and `unprivilegedSpawnOptions` may change modes above the temp directory.
describe.serial.skipIf(isWindows)("rm with an operand that fails inside its walk", () => {
  const denied = (file: string) => `rm: ${file}: Permission denied\n`;
  // Nothing can be removed from a `locked` directory. Each of its operands holds that one entry, or at
  // most four: the walk of a directory looks at the error flag of its operand at every fourth entry.
  const cases: {
    line: string;
    setup: string[];
    locked: string[];
    left: string[];
    stderr?: string;
    // Of out.txt: the first byte of each line, and the lines sorted.
    order?: string;
    out?: string[];
  }[] = [
    {
      line: "rm -rf ro ok",
      setup: ["ro/locked/f", ...tree("ok")],
      locked: ["ro/locked"],
      left: ["ro/", "ro/locked/", "ro/locked/f"],
      stderr: denied("ro/locked/f"),
    },
    {
      line: "rm -rf ok ro ok2",
      setup: ["ro/locked/f", ...tree("ok"), ...tree("ok2")],
      locked: ["ro/locked"],
      left: ["ro/", "ro/locked/", "ro/locked/f"],
      stderr: denied("ro/locked/f"),
    },
    {
      line: "rm -rv ok ro ok2 &> out.txt",
      setup: ["ro/locked/f", ...tree("ok"), ...tree("ok2")],
      locked: ["ro/locked"],
      left: ["ro/", "ro/locked/", "ro/locked/f"],
      order: "o".repeat(treeLines("ok").length) + "r" + "o".repeat(treeLines("ok2").length),
      out: [...treeLines("ok"), ...treeLines("ok2"), denied("ro/locked/f").trimEnd()].sort(),
    },
    {
      line: "rm -rv ro ro2 ok &> out.txt",
      setup: ["ro/locked/f", "ro2/locked/f", ...tree("ok")],
      locked: ["ro/locked", "ro2/locked"],
      left: ["ro/", "ro/locked/", "ro/locked/f", "ro2/", "ro2/locked/", "ro2/locked/f"],
      order: "rr" + "o".repeat(treeLines("ok").length),
      out: [...treeLines("ok"), denied("ro/locked/f").trimEnd(), denied("ro2/locked/f").trimEnd()].sort(),
    },
    // An operand below a directory that denies removal fails at once, and nothing inside it is removed.
    {
      line: "rm -rf ok ro/locked/sub",
      setup: ["ro/locked/sub/f", ...bushy("ok")],
      locked: ["ro/locked"],
      left: ["ro/", "ro/locked/", "ro/locked/sub/", "ro/locked/sub/f"],
      stderr: denied("ro/locked/sub"),
    },
    {
      line: "rm -rf ro/locked/sub ok",
      setup: ["ro/locked/sub/f", ...bushy("ok")],
      locked: ["ro/locked"],
      left: ["ro/", "ro/locked/", "ro/locked/sub/", "ro/locked/sub/f"],
      stderr: denied("ro/locked/sub"),
    },
    {
      line: "rm -rf ok f0 f1 f2 f3 f4 f5 locked/d",
      setup: [...bushy("ok"), "f0", "f1", "f2", "f3", "f4", "f5", "locked/d/f"],
      locked: ["locked"],
      left: ["locked/", "locked/d/", "locked/d/f"],
      stderr: denied("locked/d"),
    },
    // Two operands that fail inside their walks, the first one deeper, and one that is missing.
    {
      line: "rm -r ro2 ro missing",
      setup: ["ro/locked/f", "ro2/sub/locked/f"],
      locked: ["ro/locked", "ro2/sub/locked"],
      left: ["ro/", "ro/locked/", "ro/locked/f", "ro2/", "ro2/sub/", "ro2/sub/locked/", "ro2/sub/locked/f"],
      stderr: denied("ro2/sub/locked/f") + denied("ro/locked/f") + missing("missing"),
    },
    {
      // One operand that lists what it removed and then fails.
      line: "rm -rv d &> out.txt",
      setup: ["d/x", "d/locked/f", "d/y", "d/z"],
      locked: ["d/locked"],
      left: ["d/", "d/locked/", "d/locked/f"],
      order: "dddr",
      out: ["d/x", "d/y", "d/z", denied("d/locked/f").trimEnd()].sort(),
    },
  ];

  test.each(cases)("$line", async ({ line, setup, locked, left, stderr = "", order = "", out = [] }) => {
    using base = tempDir("rm-operand-walk-error", {});
    const rounds = Array.from({ length: 10 }, (_, round) => path.join(String(base), String(round)));
    for (const dir of rounds) {
      mkdirSync(dir);
      makeTree(dir, setup);
    }
    using unprivileged = unprivilegedSpawnOptions(String(base));
    const directories = rounds.flatMap(dir => locked.map(name => path.join(dir, name)));
    try {
      for (const directory of directories) chmodSync(directory, 0o555);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "exec", rounds.map(dir => `cd "${dir}" && ${line} && echo ok || echo failed`).join("\n")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        ...unprivileged,
      });
      const [stdout, stderrText, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const outputs = rounds.map(dir => {
        const { left, files } = leftIn(dir);
        const lines = (files["out.txt"] ?? "").split("\n").filter(Boolean);
        return { left, order: lines.map(line => line[0]).join(""), out: lines.sort() };
      });
      expect({ stdout, stderr: stderrText, outputs }).toEqual({
        stdout: "failed\n".repeat(rounds.length),
        stderr: stderr.repeat(rounds.length),
        outputs: rounds.map(() => ({ left, order, out })),
      });
      expect(exitCode).toBe(0);
    } finally {
      for (const directory of directories) chmodSync(directory, 0o755);
    }
  });
});
