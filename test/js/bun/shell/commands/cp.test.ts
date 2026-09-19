import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, DirectoryTree, isWindows, tempDir, tempDirWithFiles } from "harness";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
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

// The target operand is classified with stat(), as cp(1) does: a symlink to a
// directory is a directory target and `cp file linkdir` lands in the directory
// the link points at, while a link that cannot be followed is a target that does
// not exist (or a stat error). The builtin used to classify the link itself.
// The builtin is only the default on Windows; on POSIX it is switched on by an
// env var that is read once per process, so each cp runs in a child bun.
describe.concurrent("bunshell cp with a symlink as the target", () => {
  const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

  /** A working directory holding `realdir/`, `linkdir -> realdir` and `files`. */
  function setup(name: string, files: DirectoryTree) {
    const dir = tempDir(`shell-cp-link-target-${name}`, { realdir: {}, ...files });
    symlinkSync("realdir", join(String(dir), "linkdir"), "dir");
    return dir;
  }

  /** Runs `command` through the shell builtin inside `cwd`; returns cp's exit code and output. */
  async function cp(cwd: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "const r = await Bun.$`${{ raw: process.argv[1] }}`.nothrow().quiet();" +
          "console.log(JSON.stringify({ exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }));",
        command,
      ],
      cwd,
      env: builtinEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  const copied = { exitCode: 0, stdout: "", stderr: "" };

  test("file -> linkdir", async () => {
    using dir = setup("file", { "file.txt": "data\n" });
    const cwd = String(dir);

    expect(await cp(cwd, "cp -v file.txt linkdir")).toEqual({
      ...copied,
      stdout: `${join(cwd, "file.txt")} -> ${join(cwd, "linkdir", "file.txt")}\n`,
    });
    expect(readFileSync(join(cwd, "realdir", "file.txt"), "utf8")).toBe("data\n");
    // The link itself is left alone.
    expect(lstatSync(join(cwd, "linkdir")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(cwd, "linkdir"))).toBe("realdir");
  });

  test("file+ -> linkdir", async () => {
    using dir = setup("files", { "a.txt": "A\n", "b.txt": "B\n" });
    const cwd = String(dir);

    expect(await cp(cwd, "cp a.txt b.txt linkdir")).toEqual(copied);
    expect(readdirSync(join(cwd, "realdir")).sort()).toEqual(["a.txt", "b.txt"]);
    expect(readFileSync(join(cwd, "realdir", "a.txt"), "utf8")).toBe("A\n");
    expect(readFileSync(join(cwd, "realdir", "b.txt"), "utf8")).toBe("B\n");
  });

  test("-R file -> linkdir", async () => {
    using dir = setup("recursive-file", { "file.txt": "data\n" });
    const cwd = String(dir);

    expect(await cp(cwd, "cp -R file.txt linkdir")).toEqual(copied);
    expect(readFileSync(join(cwd, "realdir", "file.txt"), "utf8")).toBe("data\n");
    expect(lstatSync(join(cwd, "linkdir")).isSymbolicLink()).toBe(true);
  });

  test("-R dir -> linkdir", async () => {
    using dir = setup("recursive-dir", { srcdir: { "inner.txt": "inner\n" } });
    const cwd = String(dir);

    expect(await cp(cwd, "cp -R srcdir linkdir")).toEqual(copied);
    expect(readFileSync(join(cwd, "realdir", "srcdir", "inner.txt"), "utf8")).toBe("inner\n");
  });

  test.skipIf(!isWindows)("file -> junction", async () => {
    using dir = setup("junction", { "file.txt": "data\n" });
    const cwd = String(dir);
    symlinkSync(join(cwd, "realdir"), join(cwd, "junction"), "junction");

    expect(await cp(cwd, "cp file.txt junction")).toEqual(copied);
    expect(readFileSync(join(cwd, "realdir", "file.txt"), "utf8")).toBe("data\n");
  });

  // What the link points at decides; the link itself is never a directory.
  test("file+ -> link to a file is rejected", async () => {
    using dir = setup("link-to-file", { "a.txt": "A\n", "b.txt": "B\n", "target.txt": "untouched\n" });
    const cwd = String(dir);
    symlinkSync("target.txt", join(cwd, "linkfile"));

    expect(await cp(cwd, "cp a.txt b.txt linkfile")).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "cp: linkfile is not a directory\n".repeat(2),
    });
    expect(readFileSync(join(cwd, "target.txt"), "utf8")).toBe("untouched\n");
  });

  // A dangling link is a target that does not exist, even on Windows, where a
  // directory-type link carries the directory attribute itself. The three
  // tests below each pin one synopsis; the Windows build used to take the link
  // for a directory and create `missing` with the copies in it.
  test("file+ -> dangling link is rejected", async () => {
    using dir = setup("dangling", { "a.txt": "A\n", "b.txt": "B\n" });
    const cwd = String(dir);
    symlinkSync("missing", join(cwd, "dangling"), "dir");

    expect(await cp(cwd, "cp a.txt b.txt dangling")).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "cp: dangling is not a directory\n".repeat(2),
    });
    expect(existsSync(join(cwd, "missing"))).toBe(false);
    expect(readlinkSync(join(cwd, "dangling"))).toBe("missing");
  });

  // Used to exit 0 on every platform without copying anything: the link counted
  // as an existing target, and the native copy swallowed the EEXIST it got
  // creating `dangling/`.
  test("-R file+ -> dangling link is rejected", async () => {
    using dir = setup("dangling-recursive", { "a.txt": "A\n", "b.txt": "B\n" });
    const cwd = String(dir);
    symlinkSync("missing", join(cwd, "dangling"), "dir");

    expect(await cp(cwd, "cp -R a.txt b.txt dangling")).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "cp: directory dangling does not exist\n".repeat(2),
    });
    expect(existsSync(join(cwd, "missing"))).toBe(false);
    expect(readlinkSync(join(cwd, "dangling"))).toBe("missing");
  });

  // With one source the target is the file to write, and the copy addresses the
  // link itself: on POSIX the open() writes through it like BSD cp (unchanged by
  // the classification), on Windows CopyFileW refuses a directory-type link.
  test("file -> dangling link", async () => {
    using dir = setup("dangling-file", { "a.txt": "A\n" });
    const cwd = String(dir);
    symlinkSync("missing", join(cwd, "dangling"), "dir");

    if (isWindows) {
      expect(await cp(cwd, "cp a.txt dangling")).toEqual({
        exitCode: 1,
        stdout: "",
        stderr: `cp: Operation not permitted: ${join(cwd, "dangling")}\n`,
      });
      expect(existsSync(join(cwd, "missing"))).toBe(false);
    } else {
      expect(await cp(cwd, "cp a.txt dangling")).toEqual(copied);
      expect(readFileSync(join(cwd, "missing"), "utf8")).toBe("A\n");
    }
    expect(readlinkSync(join(cwd, "dangling"))).toBe("missing");
  });

  // Following the target can fail with something other than ENOENT; that is
  // reported as is (cp(1): "target 'loop': Too many levels of symbolic links").
  test("file+ -> link to itself is rejected with the stat error", async () => {
    using dir = setup("loop", { "a.txt": "A\n", "b.txt": "B\n" });
    const cwd = String(dir);
    symlinkSync("loop", join(cwd, "loop"));

    expect(await cp(cwd, "cp a.txt b.txt loop")).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `cp: Too many levels of symbolic links: ${join(cwd, "loop")}\n`.repeat(2),
    });
    expect(readdirSync(cwd).sort()).toEqual(["a.txt", "b.txt", "linkdir", "loop", "realdir"]);
  });

  // Windows distinguishes file and directory links; a file-type link to a
  // directory cannot be followed (stat fails with EPERM), so it is neither a
  // directory to copy into nor a file to copy onto.
  test.skipIf(!isWindows)("file+ -> file-type link to a directory is rejected with the stat error", async () => {
    using dir = setup("file-type-link", { "a.txt": "A\n", "b.txt": "B\n" });
    const cwd = String(dir);
    symlinkSync("realdir", join(cwd, "filelink"), "file");

    expect(await cp(cwd, "cp a.txt b.txt filelink")).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `cp: Operation not permitted: ${join(cwd, "filelink")}\n`.repeat(2),
    });
    expect(readdirSync(join(cwd, "realdir"))).toEqual([]);
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
