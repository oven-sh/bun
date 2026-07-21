/**
 * These tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) rm tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithFiles } from "harness";
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

const BUN = process.argv0;
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
    const tempdir = tempDirWithFiles("rmforce", files);

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

    const tempdir = tempDirWithFiles("rmrecursive", files);

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

    const tempdir = tempDirWithFiles("rmdir", files);

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

// POSIX: an operand whose last path component is `.` or `..` must be refused
// with a diagnostic and not processed (GNU rm: "refusing to remove '.' or
// '..' directory"). Previously these were recursed into, so the directory was
// emptied before the final rmdir failed with EINVAL.
describe.concurrent("rm refuses '.' and '..' operands", () => {
  const ops = [".", "..", "./", "../", "d/.", "d/..", "d/./"] as const;
  test.each(ops)("rm -rf %s", async op => {
    using dir = tempDir("rm-dot", { "d/a.txt": "A", "d/s/c.txt": "C" });
    const r = await $`cd d && rm -rf ${op}`.cwd(String(dir)).nothrow().quiet();
    expect({
      stderr: r.stderr.toString(),
      exitCode: r.exitCode,
      remaining: readdirSync(path.join(String(dir), "d")).sort(),
    }).toEqual({
      stderr: `rm: refusing to remove '.' or '..' directory: skipping '${op}'\n`,
      exitCode: 1,
      remaining: ["a.txt", "s"],
    });
  });

  test("skips the refused operand and still removes the others", async () => {
    using dir = tempDir("rm-dot-mixed", { "keep.txt": "K", "go.txt": "G" });
    const r = await $`rm -rf . go.txt`.cwd(String(dir)).nothrow().quiet();
    expect({
      stderr: r.stderr.toString(),
      exitCode: r.exitCode,
      remaining: readdirSync(String(dir)).sort(),
    }).toEqual({
      stderr: "rm: refusing to remove '.' or '..' directory: skipping '.'\n",
      exitCode: 1,
      remaining: ["keep.txt"],
    });
  });

  test("does not refuse dotfiles", async () => {
    using dir = tempDir("rm-dot-ok", { ".hidden": "H", ".h2/x.txt": "X" });
    const r = await $`rm -rf .hidden .h2`.cwd(String(dir)).nothrow().quiet();
    expect({ stderr: r.stderr.toString(), exitCode: r.exitCode, remaining: readdirSync(String(dir)) }).toEqual({
      stderr: "",
      exitCode: 0,
      remaining: [],
    });
  });

  // Win32 path normalization strips trailing periods from path components, so a
  // directory literally named `...` does not round-trip through the harness.
  test.skipIf(isWindows)("does not refuse '...'", async () => {
    using dir = tempDir("rm-dots-ok", { ".../x.txt": "X" });
    const r = await $`rm -rf ...`.cwd(String(dir)).nothrow().quiet();
    expect({ stderr: r.stderr.toString(), exitCode: r.exitCode, remaining: readdirSync(String(dir)) }).toEqual({
      stderr: "",
      exitCode: 0,
      remaining: [],
    });
  });

  test.skipIf(isWindows)("still refuses '/'", async () => {
    using dir = tempDir("rm-root", {});
    const r = await $`rm -rf /`.cwd(String(dir)).nothrow().quiet();
    expect({ exitCode: r.exitCode, stderr: r.stderr.toString() }).toEqual({
      exitCode: 1,
      stderr: 'rm: "/" may not be removed\n',
    });
  });
});

// The preserve-root guard resolves relative operands against the shell
// instance's cwd (set via `$.cwd()` / `cd`), not the host process cwd.
// With the process launched from `/`, a relative operand used to resolve to a
// top-level path and be spuriously refused.
test.skipIf(isWindows)("rm preserve-root guard resolves against the shell cwd", async () => {
  using dir = tempDir("rm-guard-cwd", { "sub/a.txt": "A" });
  const fixture = `
    import { $ } from "bun";
    $.nothrow();
    const r = await $\`rm -rf sub\`.cwd(${JSON.stringify(String(dir))}).quiet();
    console.log(JSON.stringify({ exitCode: r.exitCode, stderr: r.stderr.toString() }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: "/",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect({ ...JSON.parse(stdout.trim()), subExists: existsSync(path.join(String(dir), "sub")) }).toEqual({
    exitCode: 0,
    stderr: "",
    subExists: false,
  });
  expect(exitCode).toBe(0);
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
      const root = tempDirWithFiles(`rm-swap-${iter}`, files);
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
