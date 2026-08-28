import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir, tempDirWithFiles } from "harness";
import { linkSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join, parse, relative } from "node:path";
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

// Windows needs a privilege or developer mode for symlinks (CI has it); junctions never do.
const canCreateSymlink = (() => {
  using probe = tempDir("shell-cp-symlink-probe", { "target": "" });
  try {
    symlinkSync("target", join(String(probe), "link"));
    return true;
  } catch (err: any) {
    if (err.code === "EPERM" || err.code === "EACCES") return false;
    throw err;
  }
})();

// The builtin is the default only on Windows; on POSIX it is enabled by an env
// var that is read once per process, so each of these runs cp in a child bun.
describe.concurrent("bunshell cp of a source onto itself", () => {
  const builtinEnv = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };

  /** A temp dir holding `d/f`, the file the tests copy; `extra` adds to it. */
  function setup(name: string, extra: (work: string) => void = () => {}) {
    const dir = tempDir(`shell-cp-same-file-${name}`, { "d": { "f": "F\n" } });
    extra(String(dir));
    return dir;
  }

  /** Runs `command` through the shell in `work` and returns cp's exit code followed by its stderr. */
  async function cp(work: string, command: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const result = await Bun.$\`${command}\`.nothrow().quiet();
         process.stdout.write(result.exitCode + "\\n" + result.stderr.toString());`,
      ],
      cwd: work,
      env: builtinEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  function refused(src: string, tgt: string) {
    return { stdout: `1\ncp: ${src} and ${tgt} are identical (not copied)\n`, stderr: "", exitCode: 0 };
  }
  const copied = { stdout: "0\n", stderr: "", exitCode: 0 };
  /** What the builtin puts between a directory operand and the basename it appends to it. */
  const sep = isWindows ? "\\" : "/";

  // Larger than the 128 KB above which the macOS copy unlinks the destination
  // before cloning the source into its place.
  const big = Buffer.alloc(200 * 1024, "big file contents\n");

  test("into its own directory is refused", async () => {
    using dir = setup("into-own-dir", work => writeFileSync(join(work, "d/f"), big));
    expect(await cp(String(dir), "cp d/f d")).toEqual(refused("d/f", `d${sep}f`));
    expect(readFileSync(join(String(dir), "d/f")).equals(big)).toBeTrue();
  });

  test("into its own directory written with a trailing slash is refused", async () => {
    using dir = setup("trailing-slash");
    expect(await cp(String(dir), "cp d/f d/")).toEqual(refused("d/f", `d${sep}f`));
    expect(readFileSync(join(String(dir), "d/f"), "utf8")).toBe("F\n");
  });

  // The destination operand is reported as written, as cp(1) does, not normalized.
  test("into its own directory written as d/. is refused", async () => {
    using dir = setup("dot-segment");
    expect(await cp(String(dir), "cp d/f d/.")).toEqual(refused("d/f", `d/.${sep}f`));
  });

  test("into its own directory written with a very long operand is refused", async () => {
    using dir = setup("long-operand");
    // Climbs to the filesystem root and back down into the temp dir: resolves
    // to a short absolute path, but as written it is longer than PATH_MAX (4096
    // on Linux), so reporting it must not go through a path buffer.
    const { root } = parse(String(dir));
    const fromRoot = relative(root, String(dir)).replaceAll("\\", "/");
    const operand = `${Buffer.alloc(1500 * 3, "../").toString()}${fromRoot}/d`;
    expect(operand.length).toBeGreaterThan(4096);
    expect(await cp(String(dir), `cp d/f ${operand}`)).toEqual(refused("d/f", `${operand}${sep}f`));
  });

  test("into its own directory with -R is refused", async () => {
    using dir = setup("recursive");
    expect(await cp(String(dir), "cp -R d/f d")).toEqual(refused("d/f", `d${sep}f`));
    expect(readFileSync(join(String(dir), "d/f"), "utf8")).toBe("F\n");
  });

  test("onto its own path is refused", async () => {
    using dir = setup("own-path");
    expect(await cp(String(dir), "cp d/f d/f")).toEqual(refused("d/f", "d/f"));
    expect(readFileSync(join(String(dir), "d/f"), "utf8")).toBe("F\n");
  });

  test("a file target with several sources is not a directory, also for the source it is", async () => {
    using dir = setup("target-is-a-source", work => writeFileSync(join(work, "x"), "X\n"));
    expect(await cp(String(dir), "cp d/f x d/f")).toEqual({
      stdout: "1\ncp: d/f is not a directory\ncp: d/f is not a directory\n",
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(join(String(dir), "d/f"), "utf8")).toBe("F\n");
  });

  test("a directory onto itself with -R is refused", async () => {
    using dir = setup("dir-onto-itself", work => writeFileSync(join(work, "d/f"), big));
    expect(await cp(String(dir), "cp -R d .")).toEqual(refused("d", `.${sep}d`));
    expect(readdirSync(join(String(dir), "d"))).toEqual(["f"]);
    expect(readFileSync(join(String(dir), "d/f")).equals(big)).toBeTrue();
  });

  // A junction on Windows (which classifies it as a directory), a symlink elsewhere.
  test("a directory link into its own directory with -R is refused", async () => {
    using dir = setup("dir-link-into-own-dir", work => {
      mkdirSync(join(work, "d/sub"));
      symlinkSync(join(work, "d/sub"), join(work, "d/sublink"), "junction");
    });
    expect(await cp(String(dir), "cp -R d/sublink d")).toEqual(refused("d/sublink", `d${sep}sublink`));
    expect(readdirSync(join(String(dir), "d")).sort()).toEqual(["f", "sub", "sublink"]);
  });

  test("a directory into a directory that already holds a copy is merged", async () => {
    using dir = setup("merge", work => {
      mkdirSync(join(work, "e/d/old"), { recursive: true });
    });
    expect(await cp(String(dir), "cp -R d e")).toEqual(copied);
    expect(readdirSync(join(String(dir), "e/d")).sort()).toEqual(["f", "old"]);
    expect(readFileSync(join(String(dir), "e/d/f"), "utf8")).toBe("F\n");
  });

  test("a directory into a directory where its name is a link back to it is refused", async () => {
    using dir = setup("dir-link-back", work => {
      mkdirSync(join(work, "e"));
      symlinkSync(join(work, "d"), join(work, "e/d"), "junction");
    });
    expect(await cp(String(dir), "cp -R d e")).toEqual(refused("d", `e${sep}d`));
    expect(readdirSync(join(String(dir), "d"))).toEqual(["f"]);
  });

  // Inside a tree the per-file pairs are only seen by the copy itself.
  test.skipIf(isWindows)(
    "a tree whose destination leads back into it through a link is not copied onto itself",
    async () => {
      using dir = setup("tree-link-back", work => {
        mkdirSync(join(work, "p/d"), { recursive: true });
        writeFileSync(join(work, "p/d/f"), big);
        mkdirSync(join(work, "e/p"), { recursive: true });
        symlinkSync(join(work, "p/d"), join(work, "e/p/d"));
      });
      expect(await cp(String(dir), "cp -R p e")).toEqual({
        stdout: expect.stringMatching(/^1\ncp: .*[\\/]p[\\/]d[\\/]f\n$/),
        stderr: "",
        exitCode: 0,
      });
      expect(readFileSync(join(String(dir), "p/d/f")).equals(big)).toBeTrue();
    },
  );

  test("onto a hard link to itself is refused", async () => {
    using dir = setup("hard-link", work => {
      writeFileSync(join(work, "d/f"), big);
      linkSync(join(work, "d/f"), join(work, "d/g"));
    });
    expect(await cp(String(dir), "cp d/f d/g")).toEqual(refused("d/f", "d/g"));
    expect(readFileSync(join(String(dir), "d/f")).equals(big)).toBeTrue();
  });

  test("a hard link from elsewhere into the directory of its file is refused", async () => {
    using dir = setup("hard-link-elsewhere", work => {
      writeFileSync(join(work, "d/f"), big);
      mkdirSync(join(work, "e"));
      linkSync(join(work, "d/f"), join(work, "e/f"));
    });
    expect(await cp(String(dir), "cp e/f d")).toEqual(refused("e/f", `d${sep}f`));
    expect(readFileSync(join(String(dir), "d/f")).equals(big)).toBeTrue();
  });

  test("into a link to its own directory is refused", async () => {
    using dir = setup("into-dir-link", work => {
      writeFileSync(join(work, "d/f"), big);
      symlinkSync(join(work, "d"), join(work, "dj"), "junction");
    });
    expect(await cp(String(dir), "cp d/f dj/")).toEqual(refused("d/f", `dj${sep}f`));
    expect(readFileSync(join(String(dir), "d/f")).equals(big)).toBeTrue();
  });

  test.skipIf(!canCreateSymlink)("onto a symlink to itself is refused", async () => {
    using dir = setup("onto-symlink", work => symlinkSync("f", join(work, "d/link")));
    expect(await cp(String(dir), "cp d/f d/link")).toEqual(refused("d/f", "d/link"));
    expect(readFileSync(join(String(dir), "d/f"), "utf8")).toBe("F\n");
  });

  test.skipIf(!canCreateSymlink)("a symlink onto the file it points to is refused", async () => {
    using dir = setup("symlink-onto-target", work => symlinkSync("f", join(work, "d/link")));
    expect(await cp(String(dir), "cp d/link d/f")).toEqual(refused("d/link", "d/f"));
    expect(readFileSync(join(String(dir), "d/f"), "utf8")).toBe("F\n");
    expect(readlinkSync(join(String(dir), "d/link"))).toBe("f");
  });

  test.skipIf(!canCreateSymlink)("a symlink into its own directory is refused", async () => {
    using dir = setup("symlink-into-own-dir", work => symlinkSync("f", join(work, "d/link")));
    expect(await cp(String(dir), "cp d/link d")).toEqual(refused("d/link", `d${sep}link`));
    expect(readlinkSync(join(String(dir), "d/link"))).toBe("f");
  });

  test.skipIf(!canCreateSymlink)("a symlink onto another symlink to the same file is refused", async () => {
    using dir = setup("two-symlinks", work => {
      symlinkSync("f", join(work, "d/link"));
      symlinkSync("f", join(work, "d/link2"));
    });
    expect(await cp(String(dir), "cp d/link d/link2")).toEqual(refused("d/link", "d/link2"));
    expect(readFileSync(join(String(dir), "d/f"), "utf8")).toBe("F\n");
  });

  test.skipIf(!canCreateSymlink)("a dangling symlink into its own directory with -R is refused", async () => {
    using dir = setup("dangling-symlink", work => symlinkSync("nowhere", join(work, "d/dangling")));
    expect(await cp(String(dir), "cp -R d/dangling d")).toEqual(refused("d/dangling", `d${sep}dangling`));
    expect(readlinkSync(join(String(dir), "d/dangling"))).toBe("nowhere");
  });

  // Not on Windows: there the copy itself fails on a dangling link (it opens the target to recreate it).
  test.skipIf(isWindows)("a dangling symlink onto another dangling symlink is not refused", async () => {
    using dir = setup("two-dangling-symlinks", work => {
      symlinkSync("nowhere", join(work, "d/dangling"));
      symlinkSync("elsewhere", join(work, "d/dangling2"));
    });
    expect(await cp(String(dir), "cp -R d/dangling d/dangling2")).toEqual(copied);
  });

  test("the other sources are still copied when one of them is refused", async () => {
    using dir = setup("one-of-many", work => writeFileSync(join(work, "other"), "other\n"));
    expect(await cp(String(dir), "cp d/f other d")).toEqual(refused("d/f", `d${sep}f`));
    expect(readFileSync(join(String(dir), "d/other"), "utf8")).toBe("other\n");
  });

  test("into another directory is copied", async () => {
    using dir = setup("other-dir", work => mkdirSync(join(work, "e")));
    expect(await cp(String(dir), "cp d/f e")).toEqual(copied);
    expect(readFileSync(join(String(dir), "e/f"), "utf8")).toBe("F\n");
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
