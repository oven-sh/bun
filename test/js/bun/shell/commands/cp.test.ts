import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir, tempDirWithFiles } from "harness";
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

// The builtin resolved each operand (and `target/basename` when copying into a
// directory) into fixed-size path buffers without checking that the result fit,
// so an operand longer than the buffer aborted the whole process. Runs in a
// child process so the abort shows up as a failed assertion; on POSIX the cp
// builtin is experimental and must be enabled explicitly.
test("operands longer than the path buffers are reported as ENAMETOOLONG", async () => {
  using dir = tempDir("cp-long-operands", {
    "f": "source",
    "target": {},
    "cp-long-operands-fixture.ts": /* ts */ `
      import { $ } from "bun";
      import { existsSync, mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      $.nothrow();
      const cwd = process.cwd();
      // Longer than the path buffer on every platform (1024 bytes on macOS,
      // 4096 on Linux, 98302 on Windows).
      const over = Buffer.alloc(100_000, "a").toString();
      // Applied in order; the deep directory below goes in front because its
      // path starts with cwd.
      const placeholders: [string, string][] = [[over, "<over>"], [cwd, "<cwd>"]];

      async function cp(...args: string[]) {
        const { exitCode, stderr } = await $\`cp \${args}\`.quiet();
        let message = stderr.toString();
        for (const [value, placeholder] of placeholders) message = message.replaceAll(value, placeholder);
        return { exitCode, stderr: message };
      }

      const names: Record<string, string> = {};
      const results: Record<string, unknown> = {};
      results.longSource = await cp(over, "target");
      results.longTarget = await cp("f", over);
      results.longAbsoluteTarget = await cp("f", join(cwd, over));
      results.longSourceAmongOthers = { ...(await cp("f", over, "target")), otherCopied: existsSync("target/f") };

      // Copying into a directory appends the basename to the directory's path,
      // which needs an existing directory just below the limit. Not reachable
      // on Windows, where the buffer holds more than any directory path NT
      // can address.
      if (process.platform !== "win32") {
        // A path of PATH_MAX - 1 bytes is the longest one the OS accepts.
        const PATH_MAX = process.platform === "linux" ? 4096 : 1024;
        // Nest directories until fewer than ~200 bytes remain below that, so
        // the basenames straddling the limit are short enough to exist in the
        // cwd (NAME_MAX is 255).
        const segment = Buffer.alloc(200, "d").toString();
        // Length of the name that makes \`dir/name\` exactly PATH_MAX - 1 bytes.
        const atLimitNameLength = (dir: string) => PATH_MAX - 1 - (dir.length + 1);
        let deep = join(cwd, segment);
        while (atLimitNameLength(join(deep, segment)) >= 1) deep = join(deep, segment);
        mkdirSync(deep, { recursive: true });
        placeholders.unshift([deep, "<deep>"]);

        const atLimitLength = atLimitNameLength(deep);
        names.atLimit = Buffer.alloc(atLimitLength, "s").toString();
        names.onePast = Buffer.alloc(atLimitLength + 1, "t").toString();
        names.onePastDir = Buffer.alloc(atLimitLength + 1, "u").toString();
        writeFileSync(names.atLimit, "at limit");
        writeFileSync(names.onePast, "one past");
        mkdirSync(names.onePastDir);

        results.deepPathLengths = {
          atLimit: join(deep, names.atLimit).length,
          onePast: join(deep, names.onePast).length,
        };
        results.intoDeepDirAtLimit = {
          ...(await cp(names.atLimit, deep)),
          copied: existsSync(join(deep, names.atLimit)),
        };
        results.intoDeepDirOnePast = await cp(names.onePast, deep);
        results.recursiveIntoDeepDir = await cp("-R", names.onePastDir, deep);
      }

      console.log(JSON.stringify({ names, results }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "cp-long-operands-fixture.ts"],
    env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { names, results } = JSON.parse(stdout);

  const tooLong = (path: string) => ({ exitCode: 1, stderr: `cp: File name too long: ${p(path)}\n` });
  const PATH_MAX = process.platform === "linux" ? 4096 : 1024;
  expect(results).toEqual({
    longSource: tooLong("<cwd>/<over>"),
    longTarget: tooLong("<cwd>/<over>"),
    longAbsoluteTarget: tooLong("<cwd>/<over>"),
    longSourceAmongOthers: { ...tooLong("<cwd>/<over>"), otherCopied: true },
    ...(isWindows
      ? {}
      : {
          // The fixture placed deep/<name> exactly at the OS limit and one byte past it.
          deepPathLengths: { atLimit: PATH_MAX - 1, onePast: PATH_MAX },
          intoDeepDirAtLimit: { exitCode: 0, stderr: "", copied: true },
          intoDeepDirOnePast: tooLong(`<deep>/${names.onePast}`),
          recursiveIntoDeepDir: tooLong(`<deep>/${names.onePastDir}`),
        }),
  });
  expect(exitCode).toBe(0);
});

function expectSortedOutput(expected: string) {
  return (stdout: string, tempdir: string) =>
    expect(sortedShellOutput(stdout).join("\n")).toEqual(
      sortedShellOutput(expected).join("\n").replaceAll("$TEMP_DIR", tempdir),
    );
}
