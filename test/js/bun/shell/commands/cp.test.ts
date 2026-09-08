import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, tempDir, tempDirWithFiles } from "harness";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bunExe, createTestBuilder } from "../test_builder";
import { sortedShellOutput } from "../util";
const { builtinDisabled } = shellInternals;

const TestBuilder = createTestBuilder(import.meta.path);

const p = process.platform === "win32" ? (s: string) => s.replaceAll("/", "\\") : (s: string) => s;

$.nothrow();

describe.if(!builtinDisabled("cp"))("bunshell cp", async () => {
  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; cp -v lmao.txt lmao2.txt`
    .stdout(p("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao2.txt\n"))
    .ensureTempDir()
    .testMini()
    .fileEquals("lmao2.txt", () => $`cat ${import.meta.filename}`.text())
    .runAsTest("file -> file");

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; touch lmao2.txt; cp -v lmao.txt lmao2.txt`
    .stdout(p("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao2.txt\n"))
    .ensureTempDir()
    .testMini()
    .fileEquals("lmao2.txt", () => $`cat ${import.meta.filename}`.text())
    .runAsTest("file -> existing file replaces contents");

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; mkdir lmao2; cp -v lmao.txt lmao2`
    .ensureTempDir()
    .stdout(p("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao2/lmao.txt\n"))
    .fileEquals("lmao2/lmao.txt", () => $`cat ${import.meta.filename}`.text())
    .testMini()
    .runAsTest("file -> dir");

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; cp -v lmao.txt lmao2/`
    .ensureTempDir()
    .stderr("cp: lmao2/ is not a directory\n")
    .exitCode(1)
    .testMini()
    .runAsTest("file -> non-existent dir fails");

  TestBuilder.command`cat ${import.meta.filename} > lmao.txt; cat ${import.meta.filename} > lmao2.txt; mkdir lmao3; cp -v lmao.txt lmao2.txt lmao3`
    .ensureTempDir()
    .stdout(
      expectSortedOutput(
        p("$TEMP_DIR/lmao.txt -> $TEMP_DIR/lmao3/lmao.txt\n$TEMP_DIR/lmao2.txt -> $TEMP_DIR/lmao3/lmao2.txt\n"),
      ),
    )
    .fileEquals("lmao3/lmao.txt", () => $`cat ${import.meta.filename}`.text())
    .fileEquals("lmao3/lmao2.txt", () => $`cat ${import.meta.filename}`.text())
    .testMini()
    .runAsTest("file+ -> dir");

  TestBuilder.command`mkdir lmao; mkdir lmao2; cp -v lmao lmao2 lmao3`
    .ensureTempDir()
    .stderr(expectSortedOutput("cp: lmao is a directory (not copied)\ncp: lmao2 is a directory (not copied)\n"))
    .exitCode(1)
    .testMini()
    .runAsTest("dir -> ? fails without -R");

  describe("EBUSY windows", () => {
    TestBuilder.command /* sh */ `
    echo hi! > hello.txt
    mkdir somedir 
    cp ${{ raw: Array(50).fill("hello.txt").join(" ") }} somedir 
    `
      .ensureTempDir()
      .exitCode(0)
      .fileEquals("somedir/hello.txt", "hi!\n")
      .runAsTest("doesn't fail on EBUSY when copying multiple files that are the same");
  });

  describe("uutils ported", () => {
    const TEST_EXISTING_FILE: string = "existing_file.txt";
    const TEST_HELLO_WORLD_SOURCE: string = "hello_world.txt";
    const TEST_HELLO_WORLD_SOURCE_SYMLINK: string = "hello_world.txt.link";
    const TEST_HELLO_WORLD_DEST: string = "copy_of_hello_world.txt";
    const TEST_HELLO_WORLD_DEST_SYMLINK: string = "copy_of_hello_world.txt.link";
    const TEST_HOW_ARE_YOU_SOURCE: string = "how_are_you.txt";
    const TEST_HOW_ARE_YOU_DEST: string = "hello_dir/how_are_you.txt";
    const TEST_COPY_TO_FOLDER: string = "hello_dir/";
    const TEST_COPY_TO_FOLDER_FILE: string = "hello_dir/hello_world.txt";
    const TEST_COPY_FROM_FOLDER: string = "hello_dir_with_file/";
    const TEST_COPY_FROM_FOLDER_FILE: string = "hello_dir_with_file/hello_world.txt";
    const TEST_COPY_TO_FOLDER_NEW: string = "hello_dir_new";
    const TEST_COPY_TO_FOLDER_NEW_FILE: string = "hello_dir_new/hello_world.txt";

    // beforeAll doesn't work beacuse of the way TestBuilder is setup
    const tempFiles = {
      "hello_world.txt": "Hello, World!",
      "existing_file.txt": "Cogito ergo sum.",
      "how_are_you.txt": "How are you?",
      "hello_dir": {
        "hello.txt": "",
      },
      "hello_dir_with_file": {
        "hello_world.txt": "Hello, World!",
      },
      "dir_with_10_files": {
        "0": "",
        "1": "",
        "2": "",
        "3": "",
        "4": "",
        "5": "",
        "6": "",
        "7": "",
        "8": "",
        "9": "",
      },
    };
    const tmpdir: string = tempDirWithFiles("cp-uutils", tempFiles);
    const mini_tmpdir: string = tempDirWithFiles("cp-uutils-mini", tempFiles);

    TestBuilder.command`cp ${TEST_HELLO_WORLD_SOURCE} ${TEST_HELLO_WORLD_DEST}`
      .ensureTempDir(tmpdir)
      .fileEquals(TEST_HELLO_WORLD_DEST, "Hello, World!")
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_cp");

    TestBuilder.command`cp ${TEST_HELLO_WORLD_SOURCE} ${TEST_EXISTING_FILE}`
      .ensureTempDir(tmpdir)
      .fileEquals(TEST_EXISTING_FILE, "Hello, World!")
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_existing_target");

    TestBuilder.command`cp ${TEST_HELLO_WORLD_SOURCE} ${TEST_HELLO_WORLD_SOURCE} ${TEST_COPY_TO_FOLDER}`
      .ensureTempDir(tmpdir)
      .file(TEST_EXISTING_FILE, "Hello, World!\n")
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_duplicate_files");

    TestBuilder.command`touch a; cp a a`
      .ensureTempDir(tmpdir)
      .stderr_contains("cp: a and a are identical (not copied)\n")
      .exitCode(1)
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_same_file");

    TestBuilder.command`cp ${TEST_HELLO_WORLD_SOURCE} ${TEST_HELLO_WORLD_SOURCE} ${TEST_EXISTING_FILE}`
      .ensureTempDir(tmpdir)
      .stderr_contains(`cp: ${TEST_EXISTING_FILE} is not a directory\n`)
      .exitCode(1)
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_multiple_files_target_is_file");

    TestBuilder.command`cp ${TEST_COPY_TO_FOLDER} ${TEST_HELLO_WORLD_DEST}`
      .ensureTempDir(tmpdir)
      .stderr_contains(`cp: ${TEST_COPY_TO_FOLDER} is a directory (not copied)\n`)
      .exitCode(1)
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_directory_not_recursive");

    TestBuilder.command`cp ${TEST_HELLO_WORLD_SOURCE} ${TEST_HOW_ARE_YOU_SOURCE} ${TEST_COPY_TO_FOLDER}`
      .ensureTempDir(tmpdir)
      .fileEquals(TEST_COPY_TO_FOLDER_FILE, "Hello, World!")
      .fileEquals(TEST_HOW_ARE_YOU_DEST, "How are you?")
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_multiple_files");

    TestBuilder.command`cp ${TEST_HELLO_WORLD_SOURCE} ${TEST_HOW_ARE_YOU_SOURCE} ${TEST_COPY_TO_FOLDER} && ${bunExe()} -e ${'console.log("HI")'}`
      .ensureTempDir(tmpdir)
      .stdout("HI\n")
      .runAsTest("cp_multiple_files");

    TestBuilder.command`cp -R ${TEST_COPY_FROM_FOLDER} ${TEST_COPY_TO_FOLDER_NEW}`
      .ensureTempDir(tmpdir)
      .fileEquals(TEST_COPY_TO_FOLDER_NEW_FILE, "Hello, World!")
      .testMini({ cwd: mini_tmpdir })
      .runAsTest("cp_recurse");
  });
});

// The builtin is the default `cp` on Windows only, so these spawn a child with
// it force-enabled to cover POSIX as well.
describe.concurrent("bunshell cp -R onto a link", () => {
  async function runScript<T>(cwd: string, script: string): Promise<T> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  const runCp = (cwd: string, command: string) =>
    runScript<{ exitCode: number; stderr: string }>(
      cwd,
      `
        import { $ } from "bun";
        const r = await $\`${command}\`.nothrow().quiet();
        console.log(JSON.stringify({ exitCode: r.exitCode, stderr: r.stderr.toString() }));
      `,
    );

  const tree = {
    src: { a: { "f1.txt": "from-source" } },
    dest: { src: { "keep.txt": "" } },
    outside: { "f1.txt": "original" },
  };

  test("a link at a destination subdirectory path is refused", async () => {
    using dir = tempDir("shell-cp-nested-link", tree);
    const root = String(dir);
    symlinkSync(join(root, "outside"), join(root, "dest", "src", "a"), "dir");

    const result = await runCp(root, "cp -R src dest");

    expect(result.stderr).toContain(p("dest/src/a"));
    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(root, "outside", "f1.txt"), "utf8")).toBe("original");
  });

  // "junction" makes this a junction on Windows (no symlink privilege needed)
  // and a plain symlink elsewhere.
  test("a link at the destination operand is refused", async () => {
    using dir = tempDir("shell-cp-operand-link", tree);
    const root = String(dir);
    symlinkSync(join(root, "outside"), join(root, "dest", "a"), "junction");

    const result = await runCp(root, "cp -R src/a dest");

    expect(result.stderr).toContain(p("dest/a"));
    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(root, "outside", "f1.txt"), "utf8")).toBe("original");
  });

  test("a dangling link at a destination subdirectory path is refused as existing", async () => {
    using dir = tempDir("shell-cp-dangling-link", tree);
    const root = String(dir);
    symlinkSync(join(root, "missing"), join(root, "dest", "src", "a"), "dir");

    const result = await runCp(root, "cp -R src dest");

    expect(result.stderr).toStartWith("cp: File exists: ");
    expect(result.stderr.trimEnd()).toEndWith(p("dest/src/a"));
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(root, "missing"))).toBe(false);
  });

  test("a real directory at a destination subdirectory path still merges", async () => {
    using dir = tempDir("shell-cp-nested-dir", tree);
    const root = String(dir);
    mkdirSync(join(root, "dest", "src", "a"));
    writeFileSync(join(root, "dest", "src", "a", "f2.txt"), "kept");

    const result = await runCp(root, "cp -R src dest");

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, "dest", "src", "a", "f1.txt"), "utf8")).toBe("from-source");
    expect(readFileSync(join(root, "dest", "src", "a", "f2.txt"), "utf8")).toBe("kept");
  });

  // The copy creates `D<n>/src` itself. While it fills it, the script keeps
  // moving that directory away and planting a link to `victim` at the name.
  // Files below a directory the copy made are created exclusively, so whatever
  // the interleaving, no file in `victim` is ever opened for writing.
  test("a destination directory swapped for a link mid-copy is not written through", async () => {
    const names = Array.from({ length: 40 }, (_, i) => `f${i}.txt`);
    const filesWith = (content: string) => Object.fromEntries(names.map(name => [name, content]));
    using dir = tempDir("shell-cp-swapped-link", {
      src: { ...filesWith("from-source"), sub: filesWith("from-source") },
      victim: { ...filesWith("victim"), sub: filesWith("victim") },
    });
    const root = String(dir);

    const result = await runScript<{ changed: string[] }>(
      root,
      `
        import { $ } from "bun";
        import { lstatSync, mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
        import { join } from "node:path";
        const root = process.cwd();
        const victim = join(root, "victim");
        for (let iter = 0; iter < 6; iter++) {
          const D = join(root, "D" + iter);
          mkdirSync(D);
          const slot = join(D, "src");
          let done = false;
          const copy = $\`cp -R src \${D}\`.nothrow().quiet().then(() => (done = true));
          for (let n = 0; !done; n++) {
            try {
              if (lstatSync(slot).isDirectory()) {
                renameSync(slot, join(D, "moved" + n));
                symlinkSync(victim, slot, "junction");
              } else {
                unlinkSync(slot);
              }
            } catch {}
            await new Promise(resolve => setImmediate(resolve));
          }
          await copy;
        }
        const changed = [];
        for (const name of ${JSON.stringify(names)}) {
          if (readFileSync(join(victim, name), "utf8") !== "victim") changed.push(name);
          if (readFileSync(join(victim, "sub", name), "utf8") !== "victim") changed.push("sub/" + name);
        }
        console.log(JSON.stringify({ changed }));
      `,
    );

    expect(result.changed).toEqual([]);
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
