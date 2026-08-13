import {
  convertToPlaceholder,
  exposePlaceholders,
  isReparsePoint,
  registerSyncRoot,
  setNonLinkReparsePoint,
} from "_util/windows-reparse-points.ts";
import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { isArm64, isWindows, tempDir, tempDirWithFiles } from "harness";
import { lstatSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
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

  // Only a reparse point whose tag is a name surrogate (symlink, junction) is a
  // link. Cloud-file placeholders (including the sync root directory itself),
  // deduplicated files and similar entries also carry
  // FILE_ATTRIBUTE_REPARSE_POINT but are plain files and directories; cp used
  // to recreate every one of them as a symlink pointing back at the source.
  // The fixtures are built with bun:ffi, which is unavailable on Windows arm64.
  describe.if(isWindows && !isArm64)("reparse points that are not links", () => {
    // What cp produced at `path`: a link, or the entry's kind, its contents and
    // whether the copy is itself a reparse point.
    function copied(path: string) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return "link";
      return {
        kind: stat.isDirectory() ? "directory" : "file",
        reparsePoint: isReparsePoint(path),
        contents: stat.isDirectory() ? readdirSync(path).sort() : readFileSync(path, "utf8"),
      };
    }

    test("cp -R copies the ones inside a directory as what they are", async () => {
      using srcDir = tempDir("cp-reparse-src", {
        "plain.txt": "plain",
        "plain_dir/x.txt": "x",
        "cloud/placeholder.txt": "placeholder contents",
        "tagged_dir/inner.txt": "tagged inner",
      });
      using outDir = tempDir("cp-reparse-out", {});
      const src = String(srcDir);
      symlinkSync(join(src, "plain.txt"), join(src, "file_link.txt"), "file");
      symlinkSync(join(src, "plain_dir"), join(src, "junction"), "junction");
      setNonLinkReparsePoint(join(src, "tagged_dir"));
      // Registering tags the `cloud` directory itself as well.
      using _syncRoot = registerSyncRoot(join(src, "cloud"));
      convertToPlaceholder(join(src, "cloud", "placeholder.txt"));
      using _exposed = exposePlaceholders();
      const entries = ["file_link.txt", "junction", "tagged_dir", "cloud", "cloud/placeholder.txt", "plain.txt"];
      expect(entries.map(name => isReparsePoint(join(src, name)))).toEqual([true, true, true, true, true, false]);

      const copy = join(String(outDir), "copy");
      const { stderr, exitCode } = await $`cp -R ${src} ${copy}`.quiet();
      expect(stderr.toString()).toBe("");
      expect(exitCode).toBe(0);

      expect({
        "cloud": copied(join(copy, "cloud")),
        "cloud/placeholder.txt": copied(join(copy, "cloud", "placeholder.txt")),
        "tagged_dir": copied(join(copy, "tagged_dir")),
        "tagged_dir/inner.txt": copied(join(copy, "tagged_dir", "inner.txt")),
        "plain.txt": copied(join(copy, "plain.txt")),
        "file_link.txt": copied(join(copy, "file_link.txt")),
        "junction": copied(join(copy, "junction")),
      }).toEqual({
        "cloud": { kind: "directory", reparsePoint: false, contents: ["placeholder.txt"] },
        "cloud/placeholder.txt": { kind: "file", reparsePoint: false, contents: "placeholder contents" },
        "tagged_dir": { kind: "directory", reparsePoint: false, contents: ["inner.txt"] },
        "tagged_dir/inner.txt": { kind: "file", reparsePoint: false, contents: "tagged inner" },
        "plain.txt": { kind: "file", reparsePoint: false, contents: "plain" },
        "file_link.txt": "link",
        "junction": "link",
      });
    });

    test("cp copies the one given as the operand", async () => {
      using srcDir = tempDir("cp-reparse-operand-src", {
        "placeholder.txt": "placeholder contents",
        "tagged_dir/inner.txt": "tagged inner",
      });
      using outDir = tempDir("cp-reparse-operand-out", {});
      const src = String(srcDir);
      const out = String(outDir);
      setNonLinkReparsePoint(join(src, "tagged_dir"));
      // Registering tags `src` itself as well.
      using _syncRoot = registerSyncRoot(src);
      convertToPlaceholder(join(src, "placeholder.txt"));
      using _exposed = exposePlaceholders();
      expect([src, join(src, "placeholder.txt"), join(src, "tagged_dir")].map(isReparsePoint)).toEqual([
        true,
        true,
        true,
      ]);

      const commands: Record<string, string[]> = {
        "placeholder file": [join(src, "placeholder.txt"), join(out, "file.txt")],
        "tagged directory": ["-R", join(src, "tagged_dir"), join(out, "dir")],
        "tagged directory with a trailing separator": ["-R", join(src, "tagged_dir") + "\\", join(out, "dir2")],
        "sync root directory": ["-R", src, join(out, "root")],
      };
      const results: Record<string, { stderr: string; exitCode: number }> = {};
      for (const [name, args] of Object.entries(commands)) {
        const { stderr, exitCode } = await $`cp ${args}`.quiet();
        results[name] = { stderr: stderr.toString(), exitCode };
      }
      const ok = { stderr: "", exitCode: 0 };
      expect(results).toEqual({
        "placeholder file": ok,
        "tagged directory": ok,
        "tagged directory with a trailing separator": ok,
        "sync root directory": ok,
      });

      const taggedDirectory = { kind: "directory", reparsePoint: false, contents: ["inner.txt"] };
      const placeholderFile = { kind: "file", reparsePoint: false, contents: "placeholder contents" };
      expect({
        "file.txt": copied(join(out, "file.txt")),
        "dir": copied(join(out, "dir")),
        "dir/inner.txt": copied(join(out, "dir", "inner.txt")),
        "dir2": copied(join(out, "dir2")),
        "root": copied(join(out, "root")),
        "root/placeholder.txt": copied(join(out, "root", "placeholder.txt")),
        "root/tagged_dir": copied(join(out, "root", "tagged_dir")),
      }).toEqual({
        "file.txt": placeholderFile,
        "dir": taggedDirectory,
        "dir/inner.txt": { kind: "file", reparsePoint: false, contents: "tagged inner" },
        "dir2": taggedDirectory,
        "root": { kind: "directory", reparsePoint: false, contents: ["placeholder.txt", "tagged_dir"] },
        "root/placeholder.txt": placeholderFile,
        "root/tagged_dir": taggedDirectory,
      });
    });
  });
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
