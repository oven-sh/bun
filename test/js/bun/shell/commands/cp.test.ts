import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, DirectoryTree, isWindows, tempDir, tempDirWithFiles } from "harness";
import { mkfifo } from "mkfifo";
import { lstatSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
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

// cp(1) copies the file a symlink operand points at; only `cp -R` copies the
// link itself. The builtin is the default only on Windows; on POSIX it is
// switched on by an env var that is read once per process, so every cp below
// runs in a child bun.
describe.concurrent("bunshell cp follows a symlink operand unless -R is given", () => {
  const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

  // Runs argv[2] through the shell inside `work/` and prints what cp returned.
  const runCpScript = /* ts */ `
    import { $ } from "bun";
    import { join } from "node:path";
    const result = await $\`\${{ raw: process.argv[2] }}\`.cwd(join(import.meta.dir, "work")).nothrow().quiet();
    console.log(JSON.stringify({ exitCode: result.exitCode, stderr: result.stderr.toString() }));
  `;

  /**
   * A temp dir holding the runner script and `work/`, which contains
   * `inner/target`, an empty `dest/`, the link `rel -> inner/target` and
   * whatever `extra` adds. Returns the temp dir; `work()` locates the work dir.
   */
  function setup(name: string, extra: DirectoryTree = {}) {
    const dir = tempDir(`shell-cp-follow-${name}`, {
      "run-cp.ts": runCpScript,
      "work": { "inner/target": "target\n", "dest": {}, ...extra },
    });
    symlinkSync(join("inner", "target"), join(work(dir), "rel"));
    return dir;
  }

  function work(dir: string, ...inside: string[]): string {
    return join(String(dir), "work", ...inside);
  }

  async function cp(dir: string, command: string): Promise<{ exitCode: number; stderr: string }> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run-cp.ts", command],
      cwd: String(dir),
      env: builtinEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  const copied = { exitCode: 0, stderr: "" };

  /** What `work/<name>` is now: a regular file's contents, a symlink's target, or `missing`. */
  function entry(dir: string, name: string): string {
    const path = work(dir, name);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined) return "missing";
    if (stat.isSymbolicLink()) return `symlink -> ${readlinkSync(path)}`;
    return `file: ${readFileSync(path, "utf8")}`;
  }

  test("cp link file copies the file the link points at", async () => {
    using dir = setup("file");
    expect(await cp(dir, "cp rel out")).toEqual(copied);
    expect(entry(dir, "out")).toBe("file: target\n");
  });

  test("cp link... dir copies the files the links point at", async () => {
    using dir = setup("into-dir", { "outside.txt": "outside\n", "elsewhere": {} });
    symlinkSync(join("..", "outside.txt"), work(dir, "elsewhere", "up"));
    expect(await cp(dir, "cp rel elsewhere/up dest")).toEqual(copied);
    expect([entry(dir, "dest/rel"), entry(dir, "dest/up")]).toEqual(["file: target\n", "file: outside\n"]);
  });

  // Past 128 KiB the macOS copy switches from read/write to clonefile().
  test("a link to a large file is copied as a file", async () => {
    const big = Buffer.alloc(300 * 1024, "big file\n").toString();
    using dir = setup("big", { big });
    symlinkSync("big", work(dir, "biglink"));
    expect(await cp(dir, "cp biglink out")).toEqual(copied);
    expect(lstatSync(work(dir, "out")).isSymbolicLink()).toBe(false);
    expect(readFileSync(work(dir, "out"), "utf8")).toBe(big);
  });

  test("a dangling link is an error", async () => {
    using dir = setup("dangling");
    symlinkSync("missing", work(dir, "dangling"));
    expect(await cp(dir, "cp dangling out")).toEqual({
      exitCode: 1,
      stderr: `cp: No such file or directory: ${work(dir, "dangling")}\n`,
    });
    expect(entry(dir, "out")).toBe("missing");
  });

  test("a link to a directory is an error without -R", async () => {
    using dir = setup("dirlink");
    symlinkSync("inner", work(dir, "dirlink"), "dir");
    expect(await cp(dir, "cp dirlink out")).toEqual({
      exitCode: 1,
      stderr: "cp: dirlink is a directory (not copied)\n",
    });
    expect(entry(dir, "out")).toBe("missing");
  });

  test("a link and the file it points at are the same file", async () => {
    using dir = setup("identical");
    expect(await cp(dir, "cp rel inner/target")).toEqual({
      exitCode: 1,
      stderr: "cp: rel and inner/target are identical (not copied)\n",
    });
    expect(entry(dir, "inner/target")).toBe("file: target\n");
  });

  test("a link and the same-named file it points at in the destination directory are the same file", async () => {
    using dir = setup("identical-in-dir", { "elsewhere": {} });
    symlinkSync(join("..", "inner", "target"), work(dir, "elsewhere", "target"));
    expect(await cp(dir, "cp elsewhere/target inner")).toEqual({
      exitCode: 1,
      stderr: `cp: elsewhere/target and ${p("inner/target")} are identical (not copied)\n`,
    });
    expect(entry(dir, "inner/target")).toBe("file: target\n");
  });

  test("cp -R copies the links themselves", async () => {
    using dir = setup("recursive");
    symlinkSync("inner", work(dir, "dirlink"), "dir");
    expect(await cp(dir, "cp -R rel dirlink dest")).toEqual(copied);
    expect(entry(dir, "dest/rel")).toStartWith("symlink -> ");
    expect(entry(dir, "dest/dirlink")).toStartWith("symlink -> ");
  });

  // Following the link must not mean reading the FIFO: open(2) on a FIFO with
  // no writer blocks forever.
  test.skipIf(isWindows)("a link to a FIFO is refused", async () => {
    using dir = setup("fifo");
    mkfifo(work(dir, "fifo"));
    symlinkSync("fifo", work(dir, "fifolink"));
    expect(await cp(dir, "cp fifolink out")).toEqual({
      exitCode: 1,
      stderr: `cp: Operation not supported: ${work(dir, "fifolink")}\n`,
    });
    expect(entry(dir, "out")).toBe("missing");
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
