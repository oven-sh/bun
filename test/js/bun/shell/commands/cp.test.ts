import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, isMacOS, isWindows, tempDir, tempDirWithFiles, unprivilegedSpawnOptions } from "harness";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

// Runs in a child process because the cp builtin must be enabled explicitly on POSIX.
test("operands longer than the path buffers fail with ENAMETOOLONG", async () => {
  using dir = tempDir("cp-long-operands", {
    "f": "source",
    "target": {},
    "fixture.ts": /* ts */ `
      import { $ } from "bun";
      import { existsSync, mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      $.nothrow();
      const cwd = process.cwd();
      // Longer than the path buffer on every platform.
      const over = Buffer.alloc(100_000, "a").toString();
      const placeholders: [string, string][] = [[over, "<over>"], [cwd, "<cwd>"]];

      async function cp(...args: string[]) {
        const { exitCode, stderr } = await $\`cp \${args}\`.quiet();
        let message = stderr.toString();
        for (const [value, placeholder] of placeholders) message = message.replaceAll(value, placeholder);
        return { exitCode, stderr: message };
      }

      const results: Record<string, unknown> = {};
      results.longSource = await cp(over, "target");
      results.longTarget = await cp("f", over);
      results.longSourceAmongOthers = { ...(await cp("f", over, "target")), otherCopied: existsSync("target/f") };

      // Copying into a directory appends the basename. Overflowing that join needs an existing directory
      // just below the limit, which Windows can't create.
      if (process.platform !== "win32") {
        const PATH_MAX = process.platform === "linux" ? 4096 : 1024;
        const segment = Buffer.alloc(200, "d").toString();
        let deep = join(cwd, segment);
        while (join(deep, segment).length + 2 < PATH_MAX) deep = join(deep, segment);
        mkdirSync(deep, { recursive: true });
        placeholders.unshift([deep, "<deep>"]);

        // \`deep/name\` is PATH_MAX bytes, one more than the OS accepts.
        const length = PATH_MAX - deep.length - 1;
        const file = Buffer.alloc(length, "t").toString();
        const folder = Buffer.alloc(length, "u").toString();
        placeholders.unshift([file, "<file>"], [folder, "<folder>"]);
        writeFileSync(file, "one past");
        mkdirSync(folder);
        results.intoDeepDir = await cp(file, deep);
        results.recursiveIntoDeepDir = await cp("-R", folder, deep);
      }

      console.log(JSON.stringify(results));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const tooLong = (path: string) => ({ exitCode: 1, stderr: `cp: File name too long: ${p(path)}\n` });
  expect(JSON.parse(stdout)).toEqual({
    longSource: tooLong("<cwd>/<over>"),
    longTarget: tooLong("<cwd>/<over>"),
    longSourceAmongOthers: { ...tooLong("<cwd>/<over>"), otherCopied: true },
    ...(isWindows ? {} : { intoDeepDir: tooLong("<deep>/<file>"), recursiveIntoDeepDir: tooLong("<deep>/<folder>") }),
  });
  expect(exitCode).toBe(0);
});

// The children force-enable the builtin, so these also run on POSIX.
describe.concurrent("bunshell cp options", () => {
  test("-f, -r and the long names of -R, -v, -n and -f", async () => {
    // Each command runs in a directory that holds the files a ("new") and b ("old"), and the directory d with f.
    const overwritten = { exitCode: 0, stdout: "", stderr: "", b: "new", "e/f": null };
    const kept = { ...overwritten, b: "old" };
    const verbose = { ...overwritten, stdout: p("<cwd>/a -> <cwd>/b\n") };
    const tree = { ...kept, "e/f": "tree" };
    // macOS clones a directory in one call and prints no line for it.
    const treeVerbose = { ...tree, stdout: isMacOS ? "" : p("<cwd>/d -> <cwd>/e\n<cwd>/d/f -> <cwd>/e/f\n") };
    const failed = (stderr: string) => ({ ...kept, exitCode: 1, stderr });
    const notCopied = failed("cp: d is a directory (not copied)\n");
    const unsupported = (option: string) => failed(`cp: unsupported option, please open a GitHub issue -- ${option}\n`);
    const illegal = (option: string) => failed(`cp: illegal option -- ${option}\n`);
    const usage = failed(
      "usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n" +
        "       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n",
    );
    const expected = {
      "cp -f a b": overwritten,
      "cp --force a b": overwritten,
      "cp -ff a b": overwritten,
      "cp -fv a b": verbose,
      "cp -v -f a b": verbose,
      "cp -vf a b": verbose,
      "cp -fR d e": tree,
      "cp -R -f d e": tree,
      "cp -Rf d e": tree,
      "cp -Rv -f d e": treeVerbose,
      // -f does not turn on -R.
      "cp d e": notCopied,
      "cp -f d e": notCopied,
      "cp --force d e": notCopied,
      "cp -vf d e": notCopied,
      "cp -f": usage,
      "cp -f a": usage,

      "cp -r d e": tree,
      "cp -rR d e": tree,
      "cp -rf d e": tree,
      "cp -nr d e": tree,
      "cp -rv d e": treeVerbose,
      "cp -vr d e": treeVerbose,
      "cp -rv a b": verbose,

      "cp --recursive d e": tree,
      "cp --verbose a b": verbose,
      "cp --no-clobber a b": kept,
      // Only the whole name is accepted. GNU cp also takes a prefix such as --rec.
      "cp --rec d e": illegal("-rec"),
      "cp --recursivex d e": illegal("-recursivex"),
      "cp --Force a b": illegal("-Force"),

      // -n wins over -f in every order, as in GNU cp.
      "cp -fn a b": kept,
      "cp -nf a b": kept,
      "cp -n -f a b": kept,
      "cp -f -n a b": kept,
      "cp -Rnf a b": kept,
      "cp -Rfn a b": kept,
      "cp -vnf a b": kept,
      "cp -n -Rf a b": kept,
      "cp -Rf -n a b": kept,
      "cp --no-clobber --force a b": kept,
      "cp --force --no-clobber a b": kept,

      // p is ignored when it is not the first option of its group.
      "cp -Rp a b": overwritten,
      "cp -rp d e": tree,
      "cp -rfp d e": tree,
      "cp -fp a b": overwritten,
      "cp -p a b": unsupported("-p"),
      "cp -pR a b": unsupported("-p"),
      "cp -R -p a b": unsupported("-p"),
      "cp -P a b": unsupported("-P"),

      // After R, v or n, an option that cp does not implement is ignored, as in the released versions.
      "cp -RH a b": overwritten,
      "cp -Ri a b": overwritten,
      "cp -Rz a b": overwritten,
      "cp -Ra d e": tree,
      "cp -vH a b": verbose,
      "cp -nz a b": kept,
      // After r or f, it fails.
      "cp -rT d e": illegal("T"),
      "cp -ru a b": illegal("u"),
      "cp -rL d e": unsupported("-L"),
      "cp -fi a b": unsupported("-i"),
      "cp -ra d e": unsupported("-a"),
      "cp -a d e": unsupported("-a"),
      "cp -ar d e": unsupported("-a"),
      // So does a word that only starts like -f or -r, such as a file name that a glob gives.
      "cp -force a b": illegal("orce"),
      "cp -recursive d e": illegal("ecursive"),
      "cp *.css b": illegal("onts.css"),
      "cp ./*.css b": overwritten,
    };

    using dir = tempDir("cp-options", {
      "a": "new",
      "d": { "f": "tree" },
      "-fonts.css": "new",
      "commands.json": JSON.stringify(Object.keys(expected)),
      "fixture.ts": /* ts */ `
        import { $ } from "bun";
        import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
        import commands from "./commands.json";

        $.nothrow();
        const cwd = process.cwd();
        const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

        const results: Record<string, unknown> = {};
        for (const command of commands) {
          writeFileSync("b", "old");
          rmSync("e", { recursive: true, force: true });
          const { exitCode, stdout, stderr } = await $\`\${{ raw: command }}\`.quiet();
          results[command] = {
            exitCode,
            stdout: stdout.toString().replaceAll(cwd, "<cwd>"),
            stderr: stderr.toString(),
            b: read("b"),
            "e/f": read("e/f"),
          };
        }
        console.log(JSON.stringify(results));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/14595
  test.each(["script.ts", "script.sh"])("cp -r folder dest in %s", async script => {
    using dir = tempDir("cp-r", {
      "folder": { "file": "hi" },
      "script.ts": 'import { $ } from "bun";\n\nawait $`cp -r folder dest`;\n',
      "script.sh": "#!/bin/bash -e\ncp -r folder dest\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", script],
      env: { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "dest", "file"), "utf8")).toBe("hi");
  });
});

// The child force-enables the builtin, so these also run on POSIX.
describe.concurrent("bunshell cp src/dest validation", () => {
  async function cp(cwd: string, command: string, options: { uid?: number; gid?: number } = {}) {
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
      ...options,
    });
    const [stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stderr, exitCode };
  }

  const tree = { d: { f: "hi", sub: {} }, e: { g: "there" } };
  const list = (dir: unknown, sub: string) => readdirSync(join(String(dir), sub)).sort();

  test("cp -R dir dir/sub fails and still copies the other sources", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R e d d/sub")).toEqual({
      stderr: `cp: cannot copy a directory, 'd', into itself, 'd/sub${sep}d'\n`,
      exitCode: 1,
    });
    expect(list(dir, "d/sub")).toEqual(["e"]);
  });

  test.each(["cp -R d .", "cp -Rn d .", "cp d/f d", "cp -n d/f d", "cp -n d/f d/f"])(
    "%s copies nothing and exits 0",
    async command => {
      using dir = tempDir("cp-self", tree);
      expect(await cp(String(dir), command)).toEqual({ stderr: "", exitCode: 0 });
      expect(list(dir, "d")).toEqual(["f", "sub"]);
      expect(readFileSync(join(String(dir), "d", "f"), "utf8")).toBe("hi");
    },
  );

  test("-n does not overwrite an existing destination", async () => {
    using dir = tempDir("cp-n", { ...tree, old: "old", out: { d: { f: "old" }, old: {} } });
    const read = (...path: string[]) => readFileSync(join(String(dir), ...path), "utf8");
    const silent = { stderr: "", exitCode: 0 };

    expect(await cp(String(dir), "cp -n d/f old")).toEqual(silent);
    expect(read("old")).toBe("old");
    // `out/old` is a directory.
    expect(await cp(String(dir), "cp -n old out")).toEqual(silent);
    expect(list(dir, "out/old")).toEqual([]);

    // `out/d/f` exists, `out/d/sub` and `out/e` do not.
    expect(await cp(String(dir), "cp -Rn d e out")).toEqual(silent);
    expect(read("out", "d", "f")).toBe("old");
    expect(list(dir, "out/d")).toEqual(["f", "sub"]);
    expect(read("out", "e", "g")).toBe("there");

    expect(await cp(String(dir), "cp -n d/f fresh")).toEqual(silent);
    expect(read("fresh")).toBe("hi");
  });

  // POSIX and GNU cp -f remove a destination that cannot be opened and create it again (uutils test_cp_arg_force).
  test("-f copies onto a read-only file as plain cp does", async () => {
    const sizes = [3, 200 * 1024];
    const commands = ["cp a b", "cp -f a b", "cp -n -f a b"];
    const rows = sizes.flatMap(size => commands.map(command => ({ size, command })));
    const tree: Record<string, { a: string; b: string }> = {};
    rows.forEach(({ size }, i) => (tree[i] = { a: Buffer.alloc(size, "n").toString(), b: "old" }));
    using dir = tempDir("cp-read-only", tree);
    const at = (i: number, ...file: string[]) => join(String(dir), String(i), ...file);
    rows.forEach((_, i) => chmodSync(at(i, "b"), 0o444));
    // Root ignores file modes, so the children run unprivileged. One call serves every row:
    // it changes the modes of the directories above, and a second call would race with it.
    using unprivileged = unprivilegedSpawnOptions(String(dir));
    try {
      const results = await Promise.all(
        rows.map(async ({ size, command }, i) => {
          const { stderr, exitCode } = await cp(at(i), command, unprivileged);
          const result = {
            stderr: stderr.replaceAll(at(i), "<dir>"),
            exitCode,
            replaced: readFileSync(at(i, "b"), "utf8") !== "old",
          };
          return [`${size} bytes: ${command}`, result] as const;
        }),
      );

      const denied = {
        stderr: `cp: ${isWindows ? "Operation not permitted" : "Permission denied"}: ${p("<dir>/b")}\n`,
        exitCode: 1,
        replaced: false,
      };
      // Above 128 KiB the macOS copy unlinks the destination and clones the source.
      const large = isMacOS ? { stderr: "", exitCode: 0, replaced: true } : denied;
      const skipped = { stderr: "", exitCode: 0, replaced: false };
      expect(Object.fromEntries(results)).toEqual({
        "3 bytes: cp a b": denied,
        "3 bytes: cp -f a b": denied,
        "3 bytes: cp -n -f a b": skipped,
        "204800 bytes: cp a b": large,
        "204800 bytes: cp -f a b": large,
        "204800 bytes: cp -n -f a b": skipped,
      });
    } finally {
      // A read-only file must not stop the removal of the directory.
      rows.forEach((_, i) => chmodSync(at(i, "b"), 0o644));
    }
  });

  // A p that is not the first option of its group is ignored. Only CopyFileW, the copy of Windows, keeps the time.
  test("-fp copies a file without its time, except on Windows", async () => {
    using dir = tempDir("cp-p", { a: "new" });
    const a = join(String(dir), "a");
    const then = new Date("2001-02-03T04:05:06Z");
    utimesSync(a, then, then);

    expect(await cp(String(dir), "cp -fp a b")).toEqual({ stderr: "", exitCode: 0 });
    expect(statSync(join(String(dir), "b")).mtimeMs === statSync(a).mtimeMs).toBe(isWindows);
  });

  // Directory symlinks need extra privileges on Windows.
  test.skipIf(isWindows)("cp -R dir link-to-dir fails", async () => {
    using dir = tempDir("cp-self", tree);
    symlinkSync("d", join(String(dir), "link"));
    expect(await cp(String(dir), "cp -R d link")).toEqual({
      stderr: `cp: cannot copy a directory, 'd', into itself, 'link/d'\n`,
      exitCode: 1,
    });
    expect(list(dir, "d")).toEqual(["f", "sub"]);
  });

  test("copies to a sibling whose name starts with the source's name", async () => {
    using dir = tempDir("cp-self", tree);
    expect(await cp(String(dir), "cp -R d d2")).toEqual({ stderr: "", exitCode: 0 });
    expect(list(dir, "d2")).toEqual(["f", "sub"]);
  });

  // The path is too long for macOS (PATH_MAX is 1024), and Windows fails to create it.
  test.skipIf(isMacOS || isWindows)("copies a very deep tree", async () => {
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
      // Delete bottom-up so disposing `dir` doesn't have to walk a tree this deep.
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
