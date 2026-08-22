import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isMacOS, isWindows, tempDir, tempDirWithFiles } from "harness";
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
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

// These spawn a child with the builtin force-enabled so they also run on POSIX,
// where `cp` otherwise falls through to the system binary.
describe.concurrent("bunshell cp src/dest validation", () => {
  async function cp(cwd: string, command: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = await Bun.$\`${command}\`.nothrow().quiet(); process.stdout.write(r.stderr); process.exit(r.exitCode);`,
      ],
      cwd,
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stderr, exitCode };
  }

  const tree = { d: { f: "hi", sub: {} }, e: { g: "there" }, file: "x" };
  const list = (dir: string, sub: string) => readdirSync(join(dir, sub)).sort();

  test("cp -R dir dir/sub is refused and creates nothing", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R d d/sub")).toEqual({
      stderr: `cp: cannot copy a directory, 'd', into itself, 'd/sub${sep}d'\n`,
      exitCode: 1,
    });
    expect(list(dir, "d/sub")).toEqual([]);
  });

  test("cp -R dir dir is refused", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R d d")).toEqual({
      stderr: `cp: cannot copy a directory, 'd', into itself, 'd${sep}d'\n`,
      exitCode: 1,
    });
    expect(list(dir, "d")).toEqual(["f", "sub"]);
  });

  test("cp -R dir dir/new is refused", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R d d/sub/new")).toEqual({
      stderr: `cp: cannot copy a directory, 'd', into itself, 'd/sub/new'\n`,
      exitCode: 1,
    });
    expect(list(dir, "d/sub")).toEqual([]);
  });

  test("cp -R dir . onto itself is refused", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R d .")).toEqual({
      stderr: `cp: d and .${sep}d are identical (not copied)\n`,
      exitCode: 1,
    });
    expect(list(dir, "d")).toEqual(["f", "sub"]);
  });

  // Directory symlinks need extra privileges on Windows.
  test.skipIf(isWindows)("cp -R dir link-to-dir is refused", async () => {
    using dir = tempDir("cp-self", tree);
    symlinkSync("d", join(String(dir), "link"));
    expect(await cp(String(dir), "cp -R d link")).toEqual({
      stderr: `cp: cannot copy a directory, 'd', into itself, 'link/d'\n`,
      exitCode: 1,
    });
    expect(list(dir, "d")).toEqual(["f", "sub"]);
  });

  test("other sources are still copied", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R e d d/sub")).toEqual({
      stderr: `cp: cannot copy a directory, 'd', into itself, 'd/sub${sep}d'\n`,
      exitCode: 1,
    });
    expect(list(dir, "d/sub")).toEqual(["e"]);
    expect(list(dir, "d/sub/e")).toEqual(["g"]);
  });

  test("directory onto an existing non-directory is refused", async () => {
    using dir = tempDir("cp-self", { ...tree, out: { d: "not a dir" } });
    expect(await cp(String(dir), "cp -R d out")).toEqual({
      stderr: `cp: cannot overwrite non-directory out${sep}d with directory d\n`,
      exitCode: 1,
    });
    expect(readFileSync(join(String(dir), "out/d"), "utf8")).toBe("not a dir");
  });

  test("file onto an existing directory is refused", async () => {
    using dir = tempDir("cp-self", { ...tree, out: { file: {} } });
    expect(await cp(String(dir), "cp file out")).toEqual({
      stderr: `cp: cannot overwrite directory out${sep}file with non-directory file\n`,
      exitCode: 1,
    });
    expect(list(dir, "out/file")).toEqual([]);
  });

  test("a sibling whose name has the source as a prefix is not itself", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R d d2")).toEqual({ stderr: "", exitCode: 0 });
    expect(list(dir, "d2")).toEqual(["f", "sub"]);
  });

  // Deeper than the pool thread's stack could take when the walk used a call
  // frame per level. macOS cannot hold a path this long (PATH_MAX is 1024) and
  // Windows fails to create it well before this depth.
  test.skipIf(isMacOS || isWindows)("a very deep tree is copied", async () => {
    const depth = 800;
    using dir = tempDir("cp-self", {});
    const levels = [""];
    for (let i = 0; i < depth; i++) levels.push(join(levels[i], "a"));
    const at = (root: string, level: number) => join(String(dir), root, levels[level]);
    mkdirSync(at("deep", depth), { recursive: true });
    writeFileSync(join(at("deep", depth), "leaf"), "leaf");
    try {
      expect(await cp(String(dir), "cp -R deep out")).toEqual({ stderr: "", exitCode: 0 });
      expect(readFileSync(join(at("out", depth), "leaf"), "utf8")).toBe("leaf");
    } finally {
      // Bottom-up, so disposing `dir` does not have to walk chains this deep.
      for (const root of ["deep", "out"]) {
        for (let i = depth; i >= 0; i--) rmSync(at(root, i), { recursive: true, force: true });
      }
    }
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
