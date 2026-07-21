import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isPosix, tempDir, tempDirWithFiles } from "harness";
import { existsSync, readlinkSync, symlinkSync } from "node:fs";
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

  describe("-n (no-clobber)", () => {
    TestBuilder.command`cp -n src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .file("dst", "OLD\n")
      .exitCode(0)
      .stderr("")
      .fileEquals("dst", "OLD\n")
      .fileEquals("src", "NEW\n")
      .runAsTest("does not overwrite an existing file");

    TestBuilder.command`cp -n src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .exitCode(0)
      .fileEquals("dst", "NEW\n")
      .fileEquals("src", "NEW\n")
      .runAsTest("copies when destination does not exist");

    TestBuilder.command`mkdir d; echo OLD > d/src; cp -n src d/`
      .ensureTempDir()
      .file("src", "NEW\n")
      .exitCode(0)
      .fileEquals("d/src", "OLD\n")
      .fileEquals("src", "NEW\n")
      .runAsTest("does not overwrite an existing file in a directory");

    TestBuilder.command`mkdir d; echo OLD > d/a; cp -n a b d/`
      .ensureTempDir()
      .file("a", "NEW\n")
      .file("b", "B\n")
      .exitCode(0)
      .fileEquals("d/a", "OLD\n")
      .fileEquals("d/b", "B\n")
      .fileEquals("a", "NEW\n")
      .fileEquals("b", "B\n")
      .runAsTest("skips existing but copies the rest into a directory");

    TestBuilder.command`cp -n -v src dst`
      .ensureTempDir()
      .file("src", "NEW\n")
      .file("dst", "OLD\n")
      .exitCode(0)
      .stdout("")
      .fileEquals("dst", "OLD\n")
      .runAsTest("-v stays quiet when the destination already exists");

    TestBuilder.command`mkdir -p srcdir dstdir; echo NEW > srcdir/a; echo NEW > srcdir/b; echo OLD > dstdir/srcdir/a; cp -R -n srcdir dstdir`
      .ensureTempDir()
      .directory("dstdir/srcdir")
      .exitCode(0)
      .fileEquals("dstdir/srcdir/a", "OLD\n")
      .fileEquals("dstdir/srcdir/b", "NEW\n")
      .runAsTest("-R -n skips existing files inside the tree");

    TestBuilder.command`touch dst; cp -n nosuch dst`
      .ensureTempDir()
      .exitCode(c => expect(c).not.toBe(0))
      .stderr(s => expect(s).toContain("nosuch"))
      .runAsTest("still reports a missing source when destination exists");
  });

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

// The `cp` builtin is POSIX-disabled by default (falls through to system cp),
// so the TestBuilder suite above is skipped on POSIX. These subprocess tests
// force the builtin on via BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS so `-n` is
// covered on every platform.
describe("bunshell cp -n (builtin forced on)", () => {
  const env = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

  async function runCp(dir: string, script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `await Bun.$\`${script}\`.cwd(${JSON.stringify(dir)})`],
      env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("does not overwrite an existing file", async () => {
    using dir = tempDir("cp-n-file", { src: "NEW\n", dst: "OLD\n" });
    const { stderr, exitCode } = await runCp(String(dir), "cp -n src dst");
    expect(stderr).toBe("");
    expect(await Bun.file(join(String(dir), "dst")).text()).toBe("OLD\n");
    expect(await Bun.file(join(String(dir), "src")).text()).toBe("NEW\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("copies when destination does not exist", async () => {
    using dir = tempDir("cp-n-new", { src: "NEW\n" });
    const { stderr, exitCode } = await runCp(String(dir), "cp -n src dst");
    expect(stderr).toBe("");
    expect(await Bun.file(join(String(dir), "dst")).text()).toBe("NEW\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("does not overwrite an existing file in a directory", async () => {
    using dir = tempDir("cp-n-dir", { src: "NEW\n", "d/src": "OLD\n" });
    const { stderr, exitCode } = await runCp(String(dir), "cp -n src d/");
    expect(stderr).toBe("");
    expect(await Bun.file(join(String(dir), "d", "src")).text()).toBe("OLD\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("skips existing but copies the rest into a directory", async () => {
    using dir = tempDir("cp-n-multi", { a: "NEW\n", b: "B\n", "d/a": "OLD\n" });
    const { stderr, exitCode } = await runCp(String(dir), "cp -n a b d/");
    expect(stderr).toBe("");
    expect(await Bun.file(join(String(dir), "d", "a")).text()).toBe("OLD\n");
    expect(await Bun.file(join(String(dir), "d", "b")).text()).toBe("B\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("-v stays quiet when the destination already exists", async () => {
    using dir = tempDir("cp-n-verbose", { src: "NEW\n", dst: "OLD\n" });
    const { stdout, stderr, exitCode } = await runCp(String(dir), "cp -n -v src dst");
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(await Bun.file(join(String(dir), "dst")).text()).toBe("OLD\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("-R -n skips existing files inside the tree", async () => {
    using dir = tempDir("cp-Rn", {
      "srcdir/a": "NEW\n",
      "srcdir/b": "NEW\n",
      "dstdir/srcdir/a": "OLD\n",
    });
    const { stderr, exitCode } = await runCp(String(dir), "cp -R -n srcdir dstdir");
    expect(stderr).toBe("");
    expect(await Bun.file(join(String(dir), "dstdir", "srcdir", "a")).text()).toBe("OLD\n");
    expect(await Bun.file(join(String(dir), "dstdir", "srcdir", "b")).text()).toBe("NEW\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("still reports a missing source when destination exists", async () => {
    using dir = tempDir("cp-n-missing", { dst: "OLD\n" });
    const { stderr, exitCode } = await runCp(String(dir), "cp -n nosuch dst");
    expect(stderr).toContain("nosuch");
    expect(await Bun.file(join(String(dir), "dst")).text()).toBe("OLD\n");
    expect(exitCode).not.toBe(0);
  });

  test.if(isPosix)("does not overwrite a dangling symlink", async () => {
    using dir = tempDir("cp-n-symlink", { src: "NEW\n" });
    symlinkSync("nonexistent", join(String(dir), "dst"));
    const { exitCode } = await runCp(String(dir), "cp -n src dst");
    expect(readlinkSync(join(String(dir), "dst"))).toBe("nonexistent");
    expect(existsSync(join(String(dir), "nonexistent"))).toBe(false);
    expect(exitCode).toBe(0);
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
