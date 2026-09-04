import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir, tempDirWithFiles } from "harness";
import { lstatSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

// The builtin is the default only on Windows; on POSIX it is enabled by an env
// var that is read once per process, so each of these runs cp in a child bun.
describe.concurrent("bunshell cp -R of a source written as dir/. or dir/..", () => {
  const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

  /** `d` is the directory being copied, `e` the existing (empty) target directory. */
  function setup() {
    return tempDir("shell-cp-dot-source", {
      "d": { "f": "F\n", "sub": { "g": "G\n" } },
      "e": {},
      "other": "other\n",
    });
  }

  /** Runs `command` through the shell in `cwd` and returns cp's exit code followed by its stderr. */
  async function cp(cwd: string, command: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const result = await Bun.$\`${command}\`.nothrow().quiet();
         process.stdout.write(result.exitCode + "\\n" + result.stderr.toString());`,
      ],
      cwd,
      env: builtinEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const copied = { stdout: "0\n", stderr: "", exitCode: 0 };
  function failed(message: string) {
    return { stdout: `1\ncp: ${message}\n`, stderr: "", exitCode: 0 };
  }

  /** Every path under `dir`, relative to it, with `/` separators. */
  function tree(dir: string) {
    return readdirSync(dir, { recursive: true })
      .map(entry => String(entry).replaceAll("\\", "/"))
      .sort();
  }
  const contentsOfD = ["f", "sub", "sub/g"];
  const dItself = ["d", "d/f", "d/sub", "d/sub/g"];

  test.each(["d/.", "d/./", "./d/.", "d/sub/.."])("cp -R %s e copies the contents of d into e", async operand => {
    using dir = setup();
    expect(await cp(String(dir), `cp -R ${operand} e`)).toEqual(copied);
    expect(tree(join(String(dir), "e"))).toEqual(contentsOfD);
    expect(readFileSync(join(String(dir), "e/sub/g"), "utf8")).toBe("G\n");
  });

  test("cp -R . ../e run inside d copies the contents of d into e", async () => {
    using dir = setup();
    expect(await cp(join(String(dir), "d"), "cp -R . ../e")).toEqual(copied);
    expect(tree(join(String(dir), "e"))).toEqual(contentsOfD);
  });

  test("cp -R d/. other e applies to that operand only", async () => {
    using dir = setup();
    expect(await cp(String(dir), "cp -R d/. other e")).toEqual(copied);
    expect(tree(join(String(dir), "e"))).toEqual(["f", "other", "sub", "sub/g"]);
  });

  test("cp -R d/. e keeps what e already holds", async () => {
    using dir = setup();
    writeFileSync(join(String(dir), "e/kept"), "kept\n");
    expect(await cp(String(dir), "cp -R d/. e")).toEqual(copied);
    expect(tree(join(String(dir), "e"))).toEqual(["f", "kept", "sub", "sub/g"]);
  });

  test.each(["d", "d/", "./d"])("cp -R %s e copies d itself into e", async operand => {
    using dir = setup();
    expect(await cp(String(dir), `cp -R ${operand} e`)).toEqual(copied);
    expect(tree(join(String(dir), "e"))).toEqual(dItself);
  });

  test("cp -R d/. new creates new holding the contents of d", async () => {
    using dir = setup();
    expect(await cp(String(dir), "cp -R d/. new")).toEqual(copied);
    expect(tree(join(String(dir), "new"))).toEqual(contentsOfD);
  });

  test("cp d/. e without -R is refused", async () => {
    using dir = setup();
    expect(await cp(String(dir), "cp d/. e")).toEqual(failed("d/. is a directory (not copied)"));
    expect(tree(join(String(dir), "e"))).toEqual([]);
  });

  test.each(["cp -R other/. e", "cp other/. e"])("%s fails because other is a file", async command => {
    using dir = setup();
    expect(await cp(String(dir), command)).toEqual(failed("Not a directory: other/."));
    expect(tree(join(String(dir), "e"))).toEqual([]);
  });

  // Creating symlinks needs extra privileges on Windows.
  describe.concurrent.skipIf(isWindows)("through a symlink", () => {
    /** Adds `dirlink -> d`, `filelink -> other` and `dangling -> nowhere` to the fixture. */
    function setupWithLinks() {
      const dir = setup();
      symlinkSync("d", join(String(dir), "dirlink"));
      symlinkSync("other", join(String(dir), "filelink"));
      symlinkSync("nowhere", join(String(dir), "dangling"));
      return dir;
    }

    test("cp -R dirlink/. e copies the contents of the directory the link points to", async () => {
      using dir = setupWithLinks();
      expect(await cp(String(dir), "cp -R dirlink/. e")).toEqual(copied);
      expect(tree(join(String(dir), "e"))).toEqual(contentsOfD);
    });

    test("cp -R dirlink e still copies the link itself", async () => {
      using dir = setupWithLinks();
      expect(await cp(String(dir), "cp -R dirlink e")).toEqual(copied);
      expect(readdirSync(join(String(dir), "e"))).toEqual(["dirlink"]);
      expect(lstatSync(join(String(dir), "e/dirlink")).isSymbolicLink()).toBeTrue();
    });

    test("cp dirlink/. e without -R is refused", async () => {
      using dir = setupWithLinks();
      expect(await cp(String(dir), "cp dirlink/. e")).toEqual(failed("dirlink/. is a directory (not copied)"));
      expect(tree(join(String(dir), "e"))).toEqual([]);
    });

    test("cp -R filelink/. e fails because the link points to a file", async () => {
      using dir = setupWithLinks();
      expect(await cp(String(dir), "cp -R filelink/. e")).toEqual(failed("Not a directory: filelink/."));
      expect(tree(join(String(dir), "e"))).toEqual([]);
    });

    test("cp -R dangling/. e fails because the link points nowhere", async () => {
      using dir = setupWithLinks();
      expect(await cp(String(dir), "cp -R dangling/. e")).toEqual(failed("No such file or directory: dangling/."));
      expect(tree(join(String(dir), "e"))).toEqual([]);
    });
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
