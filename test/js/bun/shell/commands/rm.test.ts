/**
 * These tests are derived from the [deno_task_shell](https://github.com/denoland/deno_task_shell/) rm tests, which are developed and maintained by the Deno authors.
 * Copyright 2018-2023 the Deno authors.
 *
 * This code is licensed under the MIT License: https://opensource.org/licenses/MIT
 */
import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { tempDirWithFiles } from "harness";
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

// The walker hands multi-component relative paths to asynchronous worker
// tasks ("target/sub/inner/f.txt") and each deletion syscall must not
// re-resolve that path from the original cwd. If an *intermediate* component
// ("sub") is replaced by a symlink after the walker has already opened and
// validated it, a path-based deletion of anything below it follows the link
// and lands outside the tree being removed. The extra "inner" nesting level
// is what makes the swapped component intermediate rather than final — the
// final-component case is covered by the test above.
//
// To make the race land reliably, "sub" contains a sacrificial "canary.txt"
// that the walker unlinks inline while iterating "sub". Once the canary is
// gone, "sub" has been opened and "inner" has been (or is about to be) handed
// to another worker as the multi-component path "target/sub/inner" — swapping
// "sub" at that point cannot interfere with "sub"'s own open, but every
// subsequent path-based deletion below it resolves through the symlink into
// the victim, which holds entries with the same names.
test.skipIf(process.platform === "win32")(
  "recursive rm does not unlink files through a swapped intermediate path component",
  async () => {
    const FILLER = 128;
    const ITERATIONS = 5;

    let swapped = 0;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const files: Record<string, string> = {
        "stash/.keep": "",
        "target/sub/canary.txt": "",
      };
      for (let j = 0; j < FILLER; j++) {
        files[`victim/inner/f${j}.txt`] = "important";
        files[`target/sub/inner/f${j}.txt`] = "";
      }
      const root = tempDirWithFiles(`rm-swap-mid-${iter}`, files);
      const victimDir = path.join(root, "victim");
      const target = path.join(root, "target");
      const entry = path.join(target, "sub");
      const canary = path.join(entry, "canary.txt");

      // Start the recursive delete on the worker pool. The worker threads
      // make progress concurrently with this (synchronous) JS code: wait
      // until the walker has opened "sub" and unlinked the canary, then swap
      // "sub" for a symlink to the victim while the deletion of
      // "target/sub/inner/*" is still pending.
      const running = $`rm -rf ${target}`.nothrow().quiet().run();
      const deadline = Date.now() + 10_000;
      while (existsSync(canary) && Date.now() < deadline) {}
      try {
        renameSync(entry, path.join(root, "stash", "sub"));
        symlinkSync(victimDir, entry);
        swapped++;
      } catch {
        // The walker already deleted the whole subtree; nothing to race.
      }
      const result = await running;

      // A swapped-out component means the entry is already gone from the
      // tree being removed; under -f that is not an error.
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);

      // Every victim file shares its basename with a file the walker was
      // told to delete; none of them may be reachable through the swapped
      // component.
      for (let j = 0; j < FILLER; j++) {
        expect(existsSync(path.join(victimDir, "inner", `f${j}.txt`))).toBeTrue();
      }
      expect(existsSync(victimDir)).toBeTrue();
    }
    // If no swap ever landed while the walker was mid-flight, the loop above
    // exercised nothing and the canary probe is broken.
    expect(swapped).toBeGreaterThan(0);
  },
);

// Same shape as the test above, but the leaves are empty directories so the
// racing deletion is the rmdir each worker issues for a directory it has
// finished with. That rmdir must also be addressed relative to a validated
// parent directory fd rather than re-resolving the full multi-component path.
test.skipIf(process.platform === "win32")(
  "recursive rm does not rmdir through a swapped intermediate path component",
  async () => {
    const FILLER = 64;
    const ITERATIONS = 5;

    let swapped = 0;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const files: import("harness").DirectoryTree = {
        "stash/.keep": "",
        "target/sub/canary.txt": "",
      };
      for (let j = 0; j < FILLER; j++) {
        files[`victim/inner/leaf${j}`] = {};
        files[`target/sub/inner/leaf${j}`] = {};
      }
      const root = tempDirWithFiles(`rm-swap-rmdir-${iter}`, files);
      const victimDir = path.join(root, "victim");
      const target = path.join(root, "target");
      const entry = path.join(target, "sub");
      const canary = path.join(entry, "canary.txt");

      const running = $`rm -rf ${target}`.nothrow().quiet().run();
      const deadline = Date.now() + 10_000;
      while (existsSync(canary) && Date.now() < deadline) {}
      try {
        renameSync(entry, path.join(root, "stash", "sub"));
        symlinkSync(victimDir, entry);
        swapped++;
      } catch {
        // The walker already deleted the whole subtree; nothing to race.
      }
      const result = await running;

      // A swapped-out component means the entry is already gone from the
      // tree being removed; under -f that is not an error.
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);

      // Every victim leaf directory shares its name with one the walker was
      // told to remove; none of them may be reachable through the swapped
      // component.
      for (let j = 0; j < FILLER; j++) {
        expect(existsSync(path.join(victimDir, "inner", `leaf${j}`))).toBeTrue();
      }
      expect(existsSync(victimDir)).toBeTrue();
    }
    expect(swapped).toBeGreaterThan(0);
  },
);
