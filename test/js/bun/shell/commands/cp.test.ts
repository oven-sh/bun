import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isMacOS, isWindows, tempDir, tempDirWithFiles } from "harness";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
// var that is read once per process, so these run each `cp` in a child bun.
describe.concurrent("bunshell cp -R of a directory", () => {
  const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

  // Runs argv[2] as a shell command inside `work/` and prints cp's exit code
  // followed by whatever it wrote to stderr.
  const runCpScript = /* ts */ `
    import { $ } from "bun";
    import { join } from "node:path";
    const result = await $\`\${{ raw: process.argv[2] }}\`.cwd(join(import.meta.dir, "work")).nothrow().quiet();
    process.stdout.write(result.exitCode + "\\n" + result.stderr.toString());
  `;

  /** A temp dir holding the script and `work/d/{a,sub/}`, the directory the tests copy. */
  function setup(name: string, extra: (work: string) => void = () => {}) {
    const dir = tempDir(`shell-cp-${name}`, {
      "run-cp.ts": runCpScript,
      "work": { "d": { "a": "A\n", "sub": {} } },
    });
    extra(join(String(dir), "work"));
    return dir;
  }

  async function cp(dir: string, command: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run-cp.ts", command],
      cwd: dir,
      env: builtinEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  function refused(message: string) {
    return { stdout: `1\ncp: ${message}\n`, stderr: "", exitCode: 0 };
  }
  const copied = { stdout: "0\n", stderr: "", exitCode: 0 };

  test("into its own subdirectory is refused", async () => {
    using dir = setup("into-sub");
    expect(await cp(String(dir), "cp -R d d/sub")).toEqual(
      refused(`cannot copy directory d into itself ${p("d/sub/d")}`),
    );
    expect(readdirSync(join(String(dir), "work/d/sub"))).toEqual([]);
  });

  test("into itself is refused", async () => {
    using dir = setup("into-self");
    expect(await cp(String(dir), "cp -R d d")).toEqual(refused(`cannot copy directory d into itself ${p("d/d")}`));
    expect(readdirSync(join(String(dir), "work/d")).sort()).toEqual(["a", "sub"]);
  });

  test("to a new directory below itself is refused", async () => {
    using dir = setup("new-dir-below-self");
    expect(await cp(String(dir), "cp -R d d/copy")).toEqual(refused("cannot copy directory d into itself d/copy"));
    expect(readdirSync(join(String(dir), "work/d")).sort()).toEqual(["a", "sub"]);
  });

  test("onto itself is refused", async () => {
    using dir = setup("onto-self");
    expect(await cp(String(dir), "cp -R d .")).toEqual(refused("d and d are identical (not copied)"));
    expect(readdirSync(join(String(dir), "work"))).toEqual(["d"]);
  });

  // Creating directory symlinks needs extra privileges on Windows.
  test.skipIf(isWindows)("into itself through a symlink is refused", async () => {
    using dir = setup("through-symlink", work => symlinkSync("d", join(work, "link")));
    expect(await cp(String(dir), "cp -R d link")).toEqual(refused("cannot copy directory d into itself link/d"));
    expect(readdirSync(join(String(dir), "work/d")).sort()).toEqual(["a", "sub"]);
  });

  test("the other sources are still copied when one of them would go into itself", async () => {
    using dir = setup("one-of-many", work => mkdirSync(join(work, "e")));
    expect(await cp(String(dir), "cp -R e d d/sub")).toEqual(
      refused(`cannot copy directory d into itself ${p("d/sub/d")}`),
    );
    expect(readdirSync(join(String(dir), "work/d/sub"))).toEqual(["e"]);
  });

  test("into a directory next to it is copied", async () => {
    using dir = setup("into-sibling", work => mkdirSync(join(work, "sib")));
    expect(await cp(String(dir), "cp -R d sib")).toEqual(copied);
    expect(readdirSync(join(String(dir), "work/sib/d")).sort()).toEqual(["a", "sub"]);
    expect(readFileSync(join(String(dir), "work/sib/d/a"), "utf8")).toBe("A\n");
  });

  // Deep enough that the directory walk overflowed the worker thread's stack
  // while it still used one stack frame per directory. A tree this deep cannot
  // be copied on macOS (PATH_MAX is 1024) or on Windows, where the copy creates
  // its destination paths through MAX_PATH (260 char) limited calls and stops
  // with ENAMETOOLONG about 100 levels down.
  test.skipIf(isMacOS || isWindows)("a tree 1000 directories deep is copied", async () => {
    const deepest = Array(1000).fill("a").join("/");
    using dir = setup("deep", work => {
      mkdirSync(join(work, "deep", deepest), { recursive: true });
      writeFileSync(join(work, "deep", deepest, "leaf"), "leaf\n");
    });
    try {
      expect(await cp(String(dir), "cp -R deep out")).toEqual(copied);
      expect(readFileSync(join(String(dir), "work/out", deepest, "leaf"), "utf8")).toBe("leaf\n");
    } finally {
      // fs.rmSync, which disposing `dir` falls back to, re-walks a chain this
      // deep from the top once per level and takes over 10s on it.
      await $`rm -rf ${join(String(dir), "work")}`.quiet();
    }
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
