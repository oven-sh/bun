import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir, tempDirWithFiles } from "harness";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
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
describe.concurrent("bunshell cp -R copies symlinks as written", () => {
  const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

  /** A directory holding `outside.txt` and `src/inner/target`; `addLinks` adds links to `src/`. */
  function setup(name: string, addLinks: (src: string) => void) {
    const dir = tempDir(`shell-cp-symlinks-${name}`, {
      "outside.txt": "outside\n",
      "src/inner/target": "target\n",
    });
    addLinks(join(String(dir), "src"));
    return dir;
  }

  /** Runs `command` through the shell builtin inside `cwd`; returns cp's exit code and stderr. */
  async function cp(cwd: string, command: string): Promise<{ exitCode: number; stderr: string }> {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        "const r = await Bun.$`${{ raw: process.argv[1] }}`.nothrow().quiet();" +
          "console.log(JSON.stringify({ exitCode: r.exitCode, stderr: r.stderr.toString() }));",
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

  const copied = { exitCode: 0, stderr: "" };

  function links(dir: string, names: string[]) {
    return Object.fromEntries(names.map(name => [name, readlinkSync(join(dir, name))]));
  }

  test("relative targets stay relative, so the copy does not point into the source tree", async () => {
    using dir = setup("relative", src => {
      symlinkSync("inner/target", join(src, "rel"));
      symlinkSync("../outside.txt", join(src, "up"));
      symlinkSync(join(src, "inner", "target"), join(src, "abs"));
      symlinkSync("inner", join(src, "reldir"), "dir");
    });
    const out = join(String(dir), "out");

    expect(await cp(String(dir), "cp -R src out")).toEqual(copied);
    expect(links(out, ["rel", "up", "abs", "reldir"])).toEqual({
      rel: p("inner/target"),
      up: p("../outside.txt"),
      abs: readlinkSync(join(String(dir), "src", "abs")),
      reldir: "inner",
    });
    expect(realpathSync(join(out, "rel"))).toBe(realpathSync(join(out, "inner", "target")));
    expect(readdirSync(join(out, "reldir"))).toEqual(["target"]);

    // The copy stands on its own once the source is gone.
    rmSync(join(String(dir), "src"), { recursive: true });
    expect(readFileSync(join(out, "rel"), "utf8")).toBe("target\n");
    expect(readFileSync(join(out, "up"), "utf8")).toBe("outside\n");
    expect(readFileSync(join(out, "reldir", "target"), "utf8")).toBe("target\n");
  });

  test("a dangling link is copied as written", async () => {
    using dir = setup("dangling", src => symlinkSync("missing", join(src, "dangling")));

    expect(await cp(String(dir), "cp -R src out")).toEqual(copied);
    expect(readlinkSync(join(String(dir), "out", "dangling"))).toBe("missing");
  });

  test("a link named as the source operand is copied as written", async () => {
    using dir = setup("operand", src => symlinkSync("inner/target", join(src, "rel")));

    expect(await cp(String(dir), "cp -R src/rel rel-copy")).toEqual(copied);
    expect(readlinkSync(join(String(dir), "rel-copy"))).toBe(p("inner/target"));
  });

  test.skipIf(!isWindows)("a junction is copied as a link to the same directory", async () => {
    using dir = setup("junction", src => symlinkSync(join(src, "inner"), join(src, "junction"), "junction"));
    const out = join(String(dir), "out");

    expect(await cp(String(dir), "cp -R src out")).toEqual(copied);
    expect(lstatSync(join(out, "junction")).isSymbolicLink()).toBe(true);
    expect(realpathSync(join(out, "junction"))).toBe(realpathSync(join(String(dir), "src", "inner")));
  });

  // `\\localhost\C$\...` is the administrative-share spelling of a local path, as in the node:fs cp tests.
  test.skipIf(!isWindows)("a directory link to a UNC path is copied as written", async () => {
    using dir = setup("unc", src => {
      const inner = realpathSync(join(src, "inner"));
      symlinkSync(`\\\\localhost\\${inner[0]}$\\${inner.slice(3)}`, join(src, "share"), "dir");
    });
    const out = join(String(dir), "out");

    expect(await cp(String(dir), "cp -R src out")).toEqual(copied);
    expect(readlinkSync(join(out, "share"))).toBe(readlinkSync(join(String(dir), "src", "share")));
    expect(readFileSync(join(out, "share", "target"), "utf8")).toBe("target\n");
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
