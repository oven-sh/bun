import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { isPosix, isRoot, isWindows, tempDir, tempDirWithFiles } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { createTestBuilder } from "../util";
const TestBuilder = createTestBuilder(import.meta.path);

const fileExists = async (path: string): Promise<boolean> =>
  $`ls -d ${path}`.then(o => o.stdout.toString() === `${path}\n`);

$.nothrow();

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

const BUN = process.argv0;
const DEV_NULL = process.platform === "win32" ? "NUL" : "/dev/null";

let node_modules_tempdir: string;
let nodeModulesSetup: Promise<string[]>;

let tempdir: string;
let allFiles: string[] = [];

const sortedLsOutput = (s: string) =>
  s
    .split("\n")
    .map(s => s.trim().replaceAll("\\", "/"))
    .filter(
      s =>
        s.length > 0 &&
        // GNU coreutils prints out the current directory like:
        //
        // ```
        // .:
        // a b c
        // ```
        //
        // We probably should match this
        s !== ".:",
    )
    .sort();

describe.concurrent("bunshell ls", () => {
  beforeAll(async () => {
    node_modules_tempdir = tempDirWithFiles("ls-node_modules", {});
    tempdir = tempDirWithFiles("ls", {});
    // Kick off the expensive `bun install` without awaiting so the other 26 tests
    // (which don't depend on it) can run concurrently while it completes.
    nodeModulesSetup = $`echo ${packagejson()} > package.json; ${BUN} install &> ${DEV_NULL}`
      .quiet()
      .throws(true)
      .cwd(node_modules_tempdir)
      .then(() =>
        isPosix
          ? Bun.$`ls -RA .`
              .quiet()
              .throws(true)
              .cwd(node_modules_tempdir)
              .text()
              .then(s => sortedLsOutput(s))
          : [],
      );
    // Avoid an unhandled rejection if install fails before the node_modules test awaits it.
    nodeModulesSetup.catch(() => {});
    await $`touch a b c; mkdir foo; touch foo/a foo/b foo/c`.quiet().throws(true).cwd(tempdir);

    allFiles = ["./foo:", "a", "a", "b", "b", "c", "c", "foo"];
  });

  describe("recursive", () => {
    test.if(isPosix)("node_modules", async () => {
      const allNodeModuleFiles = await nodeModulesSetup;
      const s = await Bun.$`ls -RA .`.quiet().throws(true).cwd(node_modules_tempdir).text();
      const lines = sortedLsOutput(s);
      expect(lines).toEqual(allNodeModuleFiles);
    });

    test("basic", async () => {
      const s = await Bun.$`ls -RA .`.quiet().throws(true).cwd(tempdir).text();
      const lines = sortedLsOutput(s);
      expect(lines).toEqual(allFiles);
    });
  });

  describe("basic flags", () => {
    test("no arguments (current directory)", async () => {
      await TestBuilder.command`ls`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toEqual(["a", "b", "c", "foo"].sort()))
        .run();
    });

    test("-a flag shows all files including . and ..", async () => {
      await using tempdir = tempDir("ls-show-all", {});
      await $`touch .hidden regular; mkdir .hidden-dir`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls -a`
        .setTempdir(tempdir)
        .stdout(s => {
          expect(sortedLsOutput(s)).toContain(".");
          expect(sortedLsOutput(s)).toContain("..");
          expect(sortedLsOutput(s)).toContain(".hidden");
          expect(sortedLsOutput(s)).toContain(".hidden-dir");
        })
        .run();
    });

    test("-A flag shows almost all (excludes . and ..)", async () => {
      await using tempdir = tempDir("ls-almost-all", {});
      await $`touch .hidden regular`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls -A`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).not.toContain("."))
        .stdout(s => expect(sortedLsOutput(s)).not.toContain(".."))
        .stdout(s => expect(sortedLsOutput(s)).toContain(".hidden"))
        .stdout(s => expect(sortedLsOutput(s)).toContain("regular"))
        .run();
    });

    test("-d flag lists directories themselves", async () => {
      await TestBuilder.command`ls -d foo`.setTempdir(tempdir).stdout("foo\n").run();
    });

    // test("-1 flag lists one file per line", async () => {
    //   await TestBuilder.command`ls -1`
    //     .setTempdir(tempdir)
    //     .stdout(s => expect(s.split("\n").filter(l => l.trim())).toEqual(["a", "b", "c", "foo"]))
    //     .run();
    // });
  });

  describe("multiple arguments", () => {
    test("multiple files", async () => {
      await TestBuilder.command`ls a b c`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toEqual(["a", "b", "c"]))
        .run();
    });

    test("multiple directories", async () => {
      await using tempdir = tempDir("ls-multi-dirs", {});
      await $`mkdir dir1 dir2; touch dir1/file1 dir2/file2`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls dir1 dir2`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toEqual(["dir1:", "dir2:", "file1", "file2"]))
        .run();
    });

    test("mixed files and directories", async () => {
      await TestBuilder.command`ls a foo`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toEqual(["a", "foo:", "a", "b", "c"].sort()))
        .run();
    });
  });

  describe("edge cases", () => {
    test("empty directory", async () => {
      await using tempdir = tempDir("ls-empty", {});
      await $`mkdir empty`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls empty`.setTempdir(tempdir).stdout("").run();
    });

    test("directory with only hidden files using -a", async () => {
      await using tempdir = tempDir("ls-hidden-only-a", {});
      await $`mkdir hidden-only; touch hidden-only/.hidden1 hidden-only/.hidden2`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls -a hidden-only`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toEqual([".", "..", ".hidden1", ".hidden2"]))
        .run();
    });

    test("very long filename", async () => {
      await using tempdir = tempDir("ls-long-name", {});
      const longName = "a".repeat(100);
      await $`touch ${longName}`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toContain(longName))
        .run();
    });

    test("filename with spaces", async () => {
      await using tempdir = tempDir("ls-spaces", {});
      await $`touch "file with spaces"`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toContain("file with spaces"))
        .run();
    });

    test.if(isPosix)("filename with special characters", async () => {
      await using tempdir = tempDir("ls-special", {});
      await $`touch "file-with-!@#$%^&*()"`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toContain("file-with-!@#$%^&*()"))
        .run();
    });
  });

  describe("flag combinations", () => {
    test("-Ra flag (recursive + show all)", async () => {
      await using tempdir = tempDir("ls-ra", {});
      await $`mkdir sub; touch .hidden sub/.hidden-sub`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls -Ra`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toContain(".hidden"))
        .stdout(s => expect(sortedLsOutput(s)).toContain(".hidden-sub"))
        .run();
    });

    test("-RA flag (recursive + almost all)", async () => {
      await using tempdir = tempDir("ls-ra-caps", {});
      await $`mkdir sub; touch .hidden sub/.hidden-sub`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls -RA`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toContain(".hidden"))
        .stdout(s => expect(sortedLsOutput(s)).toContain(".hidden-sub"))
        .stdout(s => expect(sortedLsOutput(s)).not.toContain("."))
        .run();
    });

    test("-a and -A: last one wins (separate args)", async () => {
      using tempdir = tempDir("ls-aA-order", {
        ".hidden": "",
        "visible": "",
      });
      await TestBuilder.command`ls -a -A`
        .setTempdir(String(tempdir))
        .stdout(s => expect(sortedLsOutput(s)).toEqual([".hidden", "visible"]))
        .run();
      await TestBuilder.command`ls -A -a`
        .setTempdir(String(tempdir))
        .stdout(s => expect(sortedLsOutput(s)).toEqual([".", "..", ".hidden", "visible"]))
        .run();
    });

    test("-a and -A: last one wins (combined arg)", async () => {
      using tempdir = tempDir("ls-aA-combined", {
        ".hidden": "",
        "visible": "",
      });
      await TestBuilder.command`ls -aA`
        .setTempdir(String(tempdir))
        .stdout(s => expect(sortedLsOutput(s)).toEqual([".hidden", "visible"]))
        .run();
      await TestBuilder.command`ls -Aa`
        .setTempdir(String(tempdir))
        .stdout(s => expect(sortedLsOutput(s)).toEqual([".", "..", ".hidden", "visible"]))
        .run();
    });

    test("-d with multiple directories", async () => {
      await using tempdir = tempDir("ls-d-multi", {});
      await $`mkdir dir1 dir2`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls -d dir1 dir2`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toEqual(["dir1", "dir2"]))
        .run();
    });
  });

  // POSIX: with -l as the last format flag, and without -H or -L, a symlink operand is listed itself. In every
  // other case a symlink to a directory is followed. The links are junctions on Windows.
  describe("symlink operand", () => {
    // A junction needs no privilege on Windows and has an absolute target. POSIX ignores the type.
    const link = (dir: string, target: string, name: string) =>
      symlinkSync(join(dir, target), join(dir, name), "junction");
    const fixture = () => {
      const dir = tempDir("ls-symlink-operand", { "dir/x": "", "file": "" });
      link(String(dir), "dir", "link");
      link(String(dir), "link", "link-to-link");
      return dir;
    };
    // `lrwxrwxrwx   1     0     0        3 Nov 04 00:00 link` becomes `l link`. A line of the short format stays.
    const entry = (line: string) => line.replace(/^(.)\S{9}(?: +\S+){7} /, "$1 ");
    const result = async (command: ReturnType<typeof $>) => {
      const { stdout, stderr, exitCode } = await command.quiet();
      const lines = stdout
        .toString()
        .split("\n")
        .filter(line => line.length > 0);
      return { stdout: lines.map(entry), stderr: stderr.toString(), exitCode };
    };
    const ls = (line: string, cwd: string) => result($`${{ raw: line }}`.cwd(cwd));
    const lists = (...stdout: string[]) => ({ stdout, stderr: "", exitCode: 0 });
    const fails = (operand: string, message: string) => ({
      stdout: [],
      stderr: `ls: ${operand}: ${message}\n`,
      exitCode: 1,
    });

    // What `ls` prints for each operand under each rule:
    //   short:    no -l. A link to a directory is followed.
    //   long:     -l is the last format flag. A link is listed itself.
    //   followed: -l with -H or -L, or with a later -C, -m or -x. The rule of `short`, in the long format.
    const missing = fails("missing", "No such file or directory");
    const throughFile = fails("through-file", "Not a directory");
    const operands = [
      // operand, short, long, followed
      ["dir", lists("x"), lists("- x"), lists("- x")],
      ["link", lists("x"), lists("l link"), lists("- x")],
      ["./link", lists("x"), lists("l ./link"), lists("- x")],
      ["link-to-link", lists("x"), lists("l link-to-link"), lists("- x")],
      ["link/", lists("x"), lists("- x"), lists("- x")],
      ["link//", lists("x"), lists("- x"), lists("- x")],
      ["link/.", lists("x"), lists("- x"), lists("- x")],
      ["link/x", lists("link/x"), lists("- link/x"), lists("- link/x")],
      ["file", lists("file"), lists("- file"), lists("- file")],
      ["missing", missing, missing, missing],
      ["file-link", lists("file-link"), lists("l file-link"), lists("l file-link")],
      ["dangling", lists("dangling"), lists("l dangling"), lists("l dangling")],
      ["loop", lists("loop"), lists("l loop"), lists("l loop")],
      ["through-file", throughFile, lists("l through-file"), throughFile],
    ] as const;
    // A junction cannot lead to a file or to itself, so these operands are for POSIX.
    const posixOnly = ["file-link", "dangling", "loop", "through-file"];
    const posixLinks = (dir: string) => {
      link(dir, "file", "file-link");
      link(dir, "missing", "dangling");
      link(dir, "loop", "loop");
      link(dir, join("file", "x"), "through-file");
    };
    // -H and -L do not read the target of these links yet. The failing rows below have what GNU prints.
    const dereferenceGaps = ["file-link", "dangling", "loop"];

    test.each([
      ["ls", 1, false],
      ["ls -l", 2, false],
      ["ls -ltr", 2, false],
      ["ls -lh", 2, false],
      ["ls -lR", 2, false],
      ["ls -Cl", 2, false],
      ["ls -lCl", 2, false],
      ["ls -lC", 3, false],
      ["ls -lm", 3, false],
      ["ls -lx", 3, false],
      ["ls -lH", 3, true],
      ["ls -Hl", 3, true],
      ["ls -l -H", 3, true],
      ["ls -H -l", 3, true],
      ["ls -lL", 3, true],
      ["ls -L -l", 3, true],
      ["ls -HCl", 3, true],
      ["ls -LCl", 3, true],
    ] as const)("%s with each operand", async (command, column, dereferences) => {
      using dir = fixture();
      if (isPosix) posixLinks(String(dir));
      const expected: Record<string, unknown> = {};
      const actual: Record<string, unknown> = {};
      for (const row of operands) {
        const operand = row[0];
        if (!isPosix && posixOnly.includes(operand)) continue;
        if (dereferences && dereferenceGaps.includes(operand)) continue;
        expected[operand] = row[column];
        actual[operand] = await ls(`${command} ${operand}`, String(dir));
      }
      expect(actual).toEqual(expected);
    });

    // Observed: the line of the link itself, and exit code 0 for a link that leads nowhere.
    describe.if(isPosix)("-H and -L read the target of a link", () => {
      test.failing.each([
        ["ls -lH file-link", lists("- file-link")],
        ["ls -lL file-link", lists("- file-link")],
        ["ls -lH dangling", fails("dangling", "No such file or directory")],
        ["ls -L dangling", fails("dangling", "No such file or directory")],
        ["ls -lL loop", fails("loop", "Too many levels of symbolic links")],
      ])("%s", async (line, expected) => {
        using dir = fixture();
        posixLinks(String(dir));
        expect(await ls(line, String(dir))).toEqual(expected);
      });
    });

    test.each([
      ["ls -la link", lists("l link")],
      ["ls -lA link", lists("l link")],
      ["ls -ld link", lists("l link")],
      ["ls -dl link", lists("l link")],
      ["ls -d link", lists("link")],
      // A `\` is a separator on Windows only.
      ...(isWindows ? ([["ls -l link\\\\", lists("- x")]] as const) : []),
    ])("%s", async (line, expected) => {
      using dir = fixture();
      expect(await ls(line, String(dir))).toEqual(expected);
    });

    test("ls -l with an absolute operand", async () => {
      using dir = fixture();
      const absolute = join(String(dir), "link");
      expect(await result($`ls -l ${absolute}`)).toEqual(lists(`l ${absolute}`));
      expect(await result($`ls -l ${absolute + "/"}`)).toEqual(lists("- x"));
    });

    test("ls -l link/sub/.. lists the directory that the link leads to", async () => {
      using dir = tempDir("ls-symlink-dotdot", { "dir/sub/x": "" });
      link(String(dir), "dir", "link");
      expect(await ls("ls -l link/sub/..", String(dir))).toEqual(lists("d sub"));
    });

    // `ls` writes the operands in the order that they complete, so the lines are sorted here.
    test("ls -l link file prints two long lines and no section", async () => {
      using dir = fixture();
      const { stdout, ...rest } = await ls("ls -l link file", String(dir));
      expect({ stdout: stdout.sort(), ...rest }).toEqual(lists("- file", "l link"));
    });

    test("ls -l * has a section for the directory and none for a link", async () => {
      using dir = fixture();
      const { stdout, ...rest } = await ls("ls -l *", String(dir));
      expect({ stdout: stdout.sort(), ...rest }).toEqual(lists("- file", "- x", "dir:", "l link", "l link-to-link"));
    });

    // On Windows `ls -l` runs `lstat` on the operand first. That call can fail for a path this long, and the
    // directory still has to be listed.
    test.if(isWindows)("ls -l lists a directory whose path is longer than MAX_PATH", async () => {
      const deep = `${Buffer.alloc(140, "a").toString()}/${Buffer.alloc(140, "b").toString()}`;
      using dir = tempDir("ls-long-path", { [`${deep}/x`]: "" });
      expect(await ls(`ls -l ${deep}`, String(dir))).toEqual(lists("- x"));
    });
  });

  describe("errors", () => {
    TestBuilder.command`ls lskdjflksdjf`
      .stderr("ls: lskdjflksdjf: No such file or directory\n")
      .exitCode(1)
      .runAsTest("ls -R lskdjflksdjf");

    test("multiple non-existent files", async () => {
      await TestBuilder.command`ls nonexistent1 nonexistent2`
        .exitCode(1)
        .stderr(s => {
          expect(s).toContain("nonexistent1: No such file or directory");
          expect(s).toContain("nonexistent2: No such file or directory");
        })
        .ensureTempDir()
        .run();
    });

    test("mixed existent and non-existent files", async () => {
      await TestBuilder.command`ls a nonexistent`
        .setTempdir(tempdir)
        .exitCode(1)
        .stdout(s => expect(sortedLsOutput(s)).toContain("a"))
        .stderr(s => expect(s).toContain("nonexistent: No such file or directory"))
        .run();
    });

    test("invalid flag", async () => {
      await TestBuilder.command`ls -z`
        .exitCode(1)
        .stderr(s => expect(s).toContain("illegal option"))
        .run();
    });

    test("invalid combined flags", async () => {
      await TestBuilder.command`ls -az`
        .exitCode(1)
        .stderr(s => expect(s).toContain("illegal option"))
        .run();
    });

    test.if(isPosix && !isRoot)("permission denied directory", async () => {
      await using tempdir = tempDir("ls-permission", {});
      await $`mkdir restricted; chmod 000 restricted; ln -s restricted link-to-restricted`
        .quiet()
        .throws(true)
        .cwd(tempdir);
      await TestBuilder.command`ls restricted`
        .setTempdir(tempdir)
        .exitCode(1)
        .stderr(s => expect(s).toContain("Permission denied"))
        .run();
      // A symlink to a directory that cannot be opened reports the open
      // error. It is not listed by name like a symlink to a file.
      await TestBuilder.command`ls link-to-restricted`
        .setTempdir(tempdir)
        .exitCode(1)
        .stdout("")
        .stderr(s => expect(s).toContain("Permission denied"))
        .run();
      await TestBuilder.command`ls -l restricted`
        .setTempdir(tempdir)
        .exitCode(1)
        .stdout("")
        .stderr(s => expect(s).toContain("Permission denied"))
        .run();
      // With -l a symlink is listed itself, so nothing that it leads to is opened.
      await $`ln -s restricted/x link-into-restricted`.quiet().throws(true).cwd(tempdir);
      for (const [flags, operand] of [
        ["-l", "link-to-restricted"],
        ["-ld", "link-to-restricted"],
        ["-l", "link-into-restricted"],
      ]) {
        await TestBuilder.command`ls ${flags} ${operand}`
          .setTempdir(tempdir)
          .exitCode(0)
          .stdout(s => {
            expect(s).toStartWith("l");
            expect(s).toEndWith(` ${operand}\n`);
          })
          .stderr("")
          .run();
      }
      await $`chmod 755 restricted`.quiet().throws(true).cwd(tempdir); // cleanup
    });

    test.if(isPosix && !isRoot)("permission denied directory recursive", async () => {
      await using tempdir = tempDir("ls-permission-recursive", {});
      // Create 3-level deep directory structure with 3+ items per level
      await $`mkdir -p level1/level2/level3; 
               touch level1/file1 level1/file2 level1/file3;
               touch level1/level2/file4 level1/level2/file5 level1/level2/file6;
               touch level1/level2/level3/file7 level1/level2/level3/file8 level1/level2/level3/file9;
               chmod 000 level1/level2`
        .quiet()
        .throws(true)
        .cwd(tempdir);

      await TestBuilder.command`ls -R level1`
        .setTempdir(tempdir)
        .exitCode(1)
        .stdout(s => expect(sortedLsOutput(s)).toContain("file1"))
        .stdout(s => expect(sortedLsOutput(s)).toContain("file2"))
        .stdout(s => expect(sortedLsOutput(s)).toContain("file3"))
        .stderr(s => expect(s).toContain("Permission denied"))
        .run();

      await $`chmod 755 level1/level2`.quiet().throws(true).cwd(tempdir); // cleanup
    });

    // A dangling symlink named on the command line is listed by name, like
    // GNU and BSD ls. Only `ls` of a nonexistent path is an error.
    test.if(isPosix)("broken symlink file", async () => {
      await using tempdir = tempDir("ls-broken-symlink", {});
      await $`touch will-remove; ln -s will-remove broken-link; rm will-remove`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls broken-link`
        .exitCode(0)
        .stdout("broken-link\n")
        .stderr("")
        .setTempdir(tempdir)
        .run();
      await TestBuilder.command`ls -l broken-link`
        .exitCode(0)
        .stdout(s => {
          // symlink perms differ between Linux (0777) and macOS (0755)
          expect(s).toStartWith("lrwx");
          expect(s).toEndWith(" broken-link\n");
        })
        .stderr("")
        .setTempdir(tempdir)
        .run();
    });

    test.if(isPosix)("broken symlink directory", async () => {
      await using tempdir = tempDir("ls-broken-symlink", {});
      await $`mkdir will-remove; ln -s will-remove broken-link; rm -rf will-remove`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls broken-link`
        .exitCode(0)
        .stdout("broken-link\n")
        .stderr("")
        .setTempdir(tempdir)
        .run();
    });

    test.if(isPosix)("symlink loop", async () => {
      await using tempdir = tempDir("ls-symlink-loop", {});
      await $`ln -s loop loop`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls loop`.exitCode(0).stdout("loop\n").stderr("").setTempdir(tempdir).run();
      await TestBuilder.command`ls loop/x`
        .exitCode(1)
        .stdout("")
        .stderr("ls: loop/x: Too many levels of symbolic links\n")
        .setTempdir(tempdir)
        .run();
    });

    test("operand whose path goes through a regular file", async () => {
      using tempdir = tempDir("ls-enotdir", { "f": "hello", "sub/a": "" });
      const notADirectory = (operand: string) => (s: string) => {
        expect(s).toStartWith(`ls: ${operand}: `);
        if (isPosix) expect(s).toBe(`ls: ${operand}: Not a directory\n`);
      };
      await TestBuilder.command`ls f/x`
        .exitCode(1)
        .stdout("")
        .stderr(notADirectory("f/x"))
        .setTempdir(String(tempdir))
        .run();
      await TestBuilder.command`ls -l f/x`
        .exitCode(1)
        .stdout("")
        .stderr(notADirectory("f/x"))
        .setTempdir(String(tempdir))
        .run();
      await TestBuilder.command`ls -d f/x`
        .exitCode(1)
        .stdout("")
        .stderr(notADirectory("f/x"))
        .setTempdir(String(tempdir))
        .run();
      await TestBuilder.command`ls f/x/y/z`
        .exitCode(1)
        .stdout("")
        .stderr(notADirectory("f/x/y/z"))
        .setTempdir(String(tempdir))
        .run();
      // The other operands are still listed.
      await TestBuilder.command`ls sub f/x`
        .exitCode(1)
        .stdout(s => expect(sortedLsOutput(s)).toEqual(["a", "sub:"]))
        .stderr(notADirectory("f/x"))
        .setTempdir(String(tempdir))
        .run();
      await TestBuilder.command`ls f f/x`
        .exitCode(1)
        .stdout("f\n")
        .stderr(notADirectory("f/x"))
        .setTempdir(String(tempdir))
        .run();
    });

    test("operand starting with a dot is not hidden", async () => {
      using tempdir = tempDir("ls-dot-operand", { ".hidden": "", "f": "hello" });
      await TestBuilder.command`ls .hidden`
        .exitCode(0)
        .stdout(".hidden\n")
        .stderr("")
        .setTempdir(String(tempdir))
        .run();
      await TestBuilder.command`ls -d .hidden`
        .exitCode(0)
        .stdout(".hidden\n")
        .stderr("")
        .setTempdir(String(tempdir))
        .run();
      await TestBuilder.command`ls ./f`.exitCode(0).stdout("./f\n").stderr("").setTempdir(String(tempdir)).run();
      await TestBuilder.command`ls -l ./f`
        .exitCode(0)
        .stdout(s => expect(s).toEndWith(" ./f\n"))
        .stderr("")
        .setTempdir(String(tempdir))
        .run();
    });

    test.if(isPosix)("broken symlink directory recursive", async () => {
      await using tempdir = tempDir("ls-broken-symlink", {});
      console.log("TEMPDIR", tempdir);
      await $`mkdir foo; cd foo; touch a b c; mkdir will-remove; ln -s will-remove broken-link; rm -rf will-remove`
        .quiet()
        .throws(true)
        .cwd(tempdir);
      await TestBuilder.command`ls -RA .`
        .setTempdir(tempdir)
        .stdout(s => expect(sortedLsOutput(s)).toEqual(["./foo:", "a", "b", "broken-link", "c", "foo"]))
        .run();
    });
  });
});

function packagejson() {
  return `{
  "name": "dummy",
  "dependencies": {
    "@biomejs/biome": "^1.5.3",
    "@vscode/debugadapter": "^1.61.0",
    "esbuild": "^0.17.15",
    "eslint": "^8.20.0",
    "eslint-config-prettier": "^8.5.0",
    "mitata": "^0.1.3",
    "peechy": "0.4.34",
    "prettier": "3.2.2",
    "react": "next",
    "react-dom": "next",
    "source-map-js": "^1.0.2",
    "typescript": "^5.0.2"
  },
  "devDependencies": {
    "@types/react": "^18.0.25",
    "@typescript-eslint/eslint-plugin": "^5.31.0",
    "@typescript-eslint/parser": "^5.31.0"
  },
  "version": "0.0.0"
}`;
}
