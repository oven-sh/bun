import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isLinux, isWindows, tempDir, tempDirWithFiles } from "harness";
import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

// The builtin is only the default on Windows; on POSIX it is switched on by an
// env var that is read once per process, so each cp runs in a child bun.
describe.concurrent("bunshell cp -R replaces an existing destination with the copied link", () => {
  const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };
  const copied = { exitCode: 0, stderr: "" };

  const at = (dir: String, ...parts: string[]) => join(String(dir), ...parts);

  /**
   * The sources: `link` and `src/link` point at `new.txt`, `dirlink` at `newdir/`.
   * `old.txt` and `olddir/` are what each test's stale destination entry points at,
   * and `dest/` is the directory the sources get copied into.
   */
  function setup(name: string) {
    const dir = tempDir(`shell-cp-replace-link-${name}`, {
      "new.txt": "new",
      "old.txt": "old",
      "newdir/marker.txt": "new",
      "olddir/marker.txt": "old",
      "src/file.txt": "file",
      dest: {},
    });
    symlinkSync(at(dir, "new.txt"), at(dir, "link"));
    symlinkSync(at(dir, "new.txt"), at(dir, "src", "link"));
    symlinkSync(at(dir, "newdir"), at(dir, "dirlink"));
    return dir;
  }

  /** Runs `command` through the shell builtin inside `dir`; returns cp's exit code and stderr. */
  async function cp(dir: String, command: string): Promise<{ exitCode: number; stderr: string }> {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "const r = await Bun.$`${{ raw: process.argv[1] }}`.nothrow().quiet();" +
          "console.log(JSON.stringify({ exitCode: r.exitCode, stderr: r.stderr.toString() }));",
        command,
      ],
      cwd: String(dir),
      env: builtinEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  /** Whether `path` is a link now, and what reading through it gives. */
  function entry(path: string) {
    return { isLink: lstatSync(path).isSymbolicLink(), reads: readFileSync(path, "utf8") };
  }

  test("links are still created where nothing exists yet", async () => {
    using dir = setup("fresh");

    expect(await cp(dir, "cp -R link dirlink src dest")).toEqual(copied);
    expect(entry(at(dir, "dest", "link"))).toEqual({ isLink: true, reads: "new" });
    expect(entry(at(dir, "dest", "dirlink", "marker.txt"))).toEqual({ isLink: false, reads: "new" });
    expect(lstatSync(at(dir, "dest", "dirlink")).isSymbolicLink()).toBe(true);
    expect(entry(at(dir, "dest", "src", "link"))).toEqual({ isLink: true, reads: "new" });
  });

  test("a stale link at the destination is replaced", async () => {
    using dir = setup("link");
    symlinkSync(at(dir, "old.txt"), at(dir, "dest", "link"));

    expect(await cp(dir, "cp -R link dest")).toEqual(copied);
    expect(entry(at(dir, "dest", "link"))).toEqual({ isLink: true, reads: "new" });
    // The stale link was removed, not written through.
    expect(readFileSync(at(dir, "old.txt"), "utf8")).toBe("old");
  });

  test("a stale directory link at the destination is replaced", async () => {
    using dir = setup("dirlink");
    symlinkSync(at(dir, "olddir"), at(dir, "dest", "dirlink"));

    expect(await cp(dir, "cp -R dirlink dest")).toEqual(copied);
    expect(lstatSync(at(dir, "dest", "dirlink")).isSymbolicLink()).toBe(true);
    expect(readFileSync(at(dir, "dest", "dirlink", "marker.txt"), "utf8")).toBe("new");
    // Removing the stale link left the directory it pointed at alone.
    expect(readFileSync(at(dir, "olddir", "marker.txt"), "utf8")).toBe("old");
  });

  test("a regular file at the destination is replaced by the link", async () => {
    using dir = setup("file");
    writeFileSync(at(dir, "dest", "link"), "stale");

    expect(await cp(dir, "cp -R link dest")).toEqual(copied);
    expect(entry(at(dir, "dest", "link"))).toEqual({ isLink: true, reads: "new" });
  });

  test("a stale link named as the target operand is replaced", async () => {
    using dir = setup("operand");
    symlinkSync(at(dir, "old.txt"), at(dir, "target"));

    expect(await cp(dir, "cp -R link target")).toEqual(copied);
    expect(entry(at(dir, "target"))).toEqual({ isLink: true, reads: "new" });
    expect(readFileSync(at(dir, "old.txt"), "utf8")).toBe("old");
  });

  test("a stale link inside an already existing destination tree is replaced", async () => {
    using dir = setup("tree");
    mkdirSync(at(dir, "dest", "src"));
    symlinkSync(at(dir, "old.txt"), at(dir, "dest", "src", "link"));

    expect(await cp(dir, "cp -R src dest")).toEqual(copied);
    expect(entry(at(dir, "dest", "src", "link"))).toEqual({ isLink: true, reads: "new" });
    expect(entry(at(dir, "dest", "src", "file.txt"))).toEqual({ isLink: false, reads: "file" });
  });

  test("a link copied onto itself is kept and the copy fails", async () => {
    using dir = setup("self");

    expect(await cp(dir, "cp -R link .")).toEqual({
      // The error names the source path, which the builtin on Windows holds back as
      // a possible EBUSY and then reports without failing the command (#37943).
      exitCode: isWindows ? 0 : 1,
      stderr: `cp: Invalid argument: ${at(dir, "link")}\n`,
    });
    expect(entry(at(dir, "link"))).toEqual({ isLink: true, reads: "new" });
  });

  test("a link copied onto the file it points at keeps the file and the copy fails", async () => {
    using dir = setup("target");

    expect(await cp(dir, "cp -R link new.txt")).toEqual({
      exitCode: 1,
      stderr: `cp: Invalid argument: ${at(dir, "new.txt")}\n`,
    });
    expect(entry(at(dir, "new.txt"))).toEqual({ isLink: false, reads: "new" });
    expect(entry(at(dir, "link"))).toEqual({ isLink: true, reads: "new" });
  });

  test("a directory at the destination is kept and the copy fails", async () => {
    using dir = setup("dir");
    mkdirSync(at(dir, "dest", "link"));
    writeFileSync(at(dir, "dest", "link", "keep.txt"), "keep");

    expect(await cp(dir, "cp -R link dest")).toEqual({
      exitCode: 1,
      // unlink refuses a directory with EISDIR on Linux and EPERM elsewhere (libuv's on Windows included).
      stderr: `cp: ${isLinux ? "Is a directory" : "Operation not permitted"}: ${at(dir, "dest", "link")}\n`,
    });
    expect(readFileSync(at(dir, "dest", "link", "keep.txt"), "utf8")).toBe("keep");
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
