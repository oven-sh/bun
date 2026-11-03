import { $ } from "bun";
import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isPosix, isRoot, tempDir, tempDirWithFiles, unprivilegedSpawnOptions } from "harness";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  symlinkSync,
  utimesSync,
  writeSync,
} from "node:fs";
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

  // The output has one order in every run. The errors of the operands come in the order of the command line. Then
  // come the operands that are not directories, and then each directory. Each of these two groups is sorted by byte.
  describe("operand order", () => {
    const two = (i: number) => String(i).padStart(2, "0");
    const parts = Array.from({ length: 12 }, (_, i) => `part-${two(i + 1)}`);
    const sortedParts = parts.join("\n") + "\n";
    // The order of creation is not the sorted order, and neither is its reverse.
    const shuffled = [7, 2, 11, 5, 1, 9, 12, 4, 8, 3, 10, 6];
    const shuffledParts = shuffled.map(i => `part-${two(i)}`).join(" ");
    const fixture = () =>
      tempDir("ls-operand-order", {
        ...Object.fromEntries(shuffled.map(i => [`part-${two(i)}`, ""])),
        d2: { x: "" },
        d3: { x: "" },
        d1: { x: "" },
        ".hidden": "",
        ".hd": { y: "" },
      });
    const noSuchFile = (operand: string) => `ls: ${operand}: No such file or directory\n`;
    const run = async (line: string, cwd: string) => {
      const { stdout, stderr, exitCode } = await $`${{ raw: line }}`.cwd(cwd).quiet();
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
    };

    test.each([
      ["files are sorted by name", `ls ${shuffledParts}`, sortedParts],
      ["the matches of a glob are sorted by name", "ls part-*", sortedParts],
      ["files come before directories", "ls d3 part-03 d2 part-01 d1", "part-01\npart-03\nd1:\nx\nd2:\nx\nd3:\nx\n"],
      ["-d lists the operands as one sorted group", "ls -d d2 part-03 d1 part-01", "d1\nd2\npart-01\npart-03\n"],
      [
        "-r reverses the sort of each group",
        "ls -r part-01 d1 part-03 d2 part-02 d3",
        "part-03\npart-02\npart-01\nd3:\nx\nd2:\nx\nd1:\nx\n",
      ],
      [
        "-U keeps the order of the command line in each group",
        "ls -U d2 part-02 d3 part-03 d1 part-01",
        "part-02\npart-03\npart-01\nd2:\nx\nd3:\nx\nd1:\nx\n",
      ],
      [
        "-r does nothing with -U",
        "ls -rU d2 part-02 d3 part-03 d1 part-01",
        "part-02\npart-03\npart-01\nd2:\nx\nd3:\nx\nd1:\nx\n",
      ],
      [
        "-f keeps the order of the command line, and lists every entry of a directory",
        "ls -f part-03 d1 part-01 part-02",
        "part-03\npart-01\npart-02\nd1:\n.\n..\nx\n",
      ],
      ["an operand named twice is listed twice", "ls d1 part-01 d1 part-01", "part-01\npart-01\nd1:\nx\nd1:\nx\n"],
      ["-R with several operands", "ls -R d2 part-01 d1", "part-01\nd1:\nx\nd2:\nx\n"],
      [
        "an operand that starts with a dot is not hidden",
        "ls part-01 .hidden d1 .hd",
        ".hidden\npart-01\n.hd:\ny\nd1:\nx\n",
      ],
      ["-d with operands that start with a dot", "ls -d part-01 .hd . .hidden", ".\n.hd\n.hidden\npart-01\n"],
    ])("%s", async (_, line, stdout) => {
      using dir = fixture();
      expect(await run(line, String(dir))).toEqual({ stdout, stderr: "", exitCode: 0 });
    });

    test.if(isPosix)("a symlink that does not lead to a directory is an entry", async () => {
      using dir = fixture();
      symlinkSync("part-01", join(String(dir), "link-to-file"));
      symlinkSync("nowhere", join(String(dir), "dangling"));
      symlinkSync("loop", join(String(dir), "loop"));
      expect(await run("ls part-02 loop dangling link-to-file d1", String(dir))).toEqual({
        stdout: "dangling\nlink-to-file\nloop\npart-02\nd1:\nx\n",
        stderr: "",
        exitCode: 0,
      });
      // The long format lists the link, not the file it leads to.
      const long = await run("ls -l part-02 link-to-file", String(dir));
      expect(long.stdout.split("\n").map(line => line.slice(0, 1) + line.slice(line.lastIndexOf(" ")))).toEqual([
        "l link-to-file",
        "- part-02",
        "",
      ]);
    });

    test("-t sorts each group by time, and -S by size", async () => {
      using dir = tempDir("ls-operand-sort-key", {
        old: "22",
        new: "1",
        "same-a": "333",
        "same-b": "333",
        "d-old": { x: "" },
        "d-new": { x: "" },
      });
      const at = (name: string, seconds: number) => utimesSync(join(String(dir), name), seconds, seconds);
      at("old", 1_000_000_000);
      at("same-b", 1_500_000_000);
      at("same-a", 1_500_000_000);
      at("new", 1_700_000_000);
      at("d-old", 1_100_000_000);
      at("d-new", 1_600_000_000);
      const operands = "d-old same-b old new d-new same-a";
      const listed = async (flags: string) => {
        const { stdout, stderr, exitCode } = await run(`ls ${flags} ${operands}`, String(dir));
        return { order: stdout.replaceAll("\nx\n", "\n").trimEnd().split("\n").join(" "), stderr, exitCode };
      };
      // The newest first, and the largest first. Names break a tie.
      expect({
        t: await listed("-t"),
        rt: await listed("-rt"),
        S: await listed("-S"),
        rS: await listed("-rS"),
        // The last of the sort flags wins.
        tU: await listed("-tU"),
        Ut: await listed("-Ut"),
      }).toEqual({
        t: { order: "new same-a same-b old d-new: d-old:", stderr: "", exitCode: 0 },
        rt: { order: "old same-b same-a new d-old: d-new:", stderr: "", exitCode: 0 },
        S: { order: "same-a same-b old new d-new: d-old:", stderr: "", exitCode: 0 },
        rS: { order: "new old same-b same-a d-old: d-new:", stderr: "", exitCode: 0 },
        tU: { order: "same-b old new same-a d-old: d-new:", stderr: "", exitCode: 0 },
        Ut: { order: "new same-a same-b old d-new: d-old:", stderr: "", exitCode: 0 },
      });
    });

    test("the sort is by byte, and the same on every platform", async () => {
      using names = tempDir("ls-operand-bytes", { "app.js": "", "Makefile": "", "README.md": "", "_config.yml": "" });
      expect(await run("ls *", String(names))).toEqual({
        stdout: "Makefile\nREADME.md\n_config.yml\napp.js\n",
        stderr: "",
        exitCode: 0,
      });
      // A path separator sorts as `/` does.
      using paths = tempDir("ls-operand-paths", { a1: { f: "" }, a: { f: "" }, "a.d": { f: "" } });
      const { stdout, stderr, exitCode } = await run("ls a*/f", String(paths));
      expect({ stdout: stdout.replaceAll("\\", "/"), stderr, exitCode }).toEqual({
        stdout: "a.d/f\na/f\na1/f\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // Enough operands that several pool tasks share the `stat` calls.
    test("many operands", async () => {
      const files = Array.from({ length: 60 }, (_, i) => `f${two(i)}`);
      const directories = Array.from({ length: 9 }, (_, i) => `g${i}`);
      using dir = tempDir("ls-many-operands", {
        ...Object.fromEntries(files.map(name => [name, ""])),
        ...Object.fromEntries(directories.map(name => [name, { x: "" }])),
      });
      // A fixed order that is not sorted: every seventh name, and the two names that do not exist in between.
      const names = [...files, "nope-b", ...directories, "nope-a"];
      const typed = names.map((_, i) => names[(i * 7) % names.length]);
      expect(await run(`ls ${typed.join(" ")}`, String(dir))).toEqual({
        stdout: files.map(name => `${name}\n`).join("") + directories.map(name => `${name}:\nx\n`).join(""),
        stderr: typed
          .filter(name => name.startsWith("nope"))
          .map(noSuchFile)
          .join(""),
        exitCode: 1,
      });
    });

    test("errors are in the order of the command line", async () => {
      using dir = fixture();
      expect(await run("ls nope-b part-02 d2 nope-a part-01 d1", String(dir))).toEqual({
        stdout: "part-01\npart-02\nd1:\nx\nd2:\nx\n",
        stderr: noSuchFile("nope-b") + noSuchFile("nope-a"),
        exitCode: 1,
      });
    });

    test("a directory has a header when a second operand fails", async () => {
      using dir = fixture();
      expect(await run("ls nope d1", String(dir))).toEqual({
        stdout: "d1:\nx\n",
        stderr: noSuchFile("nope"),
        exitCode: 1,
      });
    });

    test("-l lists the operands in the same order", async () => {
      using dir = fixture();
      const { stdout, stderr, exitCode } = await run("ls -l part-03 d2 part-01 d1", String(dir));
      const names = stdout
        .split("\n")
        .slice(0, -1)
        .map(line => line.slice(line.lastIndexOf(" ") + 1));
      expect({ names, stderr, exitCode }).toEqual({
        names: ["part-01", "part-03", "d1:", "x", "d2:", "x"],
        stderr: "",
        exitCode: 0,
      });
    });

    // Each sink takes the bytes in another way: a buffer, an IOWriter on a pipe or on a file, or the event loop of
    // `bun exec`. `fromLs` says whether the exit code is that of `ls`.
    type Sink = (
      command: string,
      merge: boolean,
      cwd: string,
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    const merged = (command: string, merge: boolean) => (merge ? `${command} 2>&1` : command);
    const shell = async (line: string, cwd: string, quiet = true) => {
      const promise = $`${{ raw: line }}`.cwd(cwd);
      const { stdout, stderr, exitCode } = await (quiet ? promise.quiet() : promise);
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
    };
    const spawned = async (cmd: string[], cwd: string) => {
      await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const sinks: [name: string, sink: Sink, fromLs: boolean][] = [
      ["captured", (command, merge, cwd) => shell(merged(command, merge), cwd), true],
      ["written to stdout", (command, merge, cwd) => shell(merged(command, merge), cwd, false), true],
      [
        "text()",
        async (command, merge, cwd) => ({
          stdout: await $`${{ raw: merged(command, merge) }}`.cwd(cwd).text(),
          stderr: "",
          exitCode: 0,
        }),
        false,
      ],
      ["command substitution", (command, merge, cwd) => shell(`echo "$(${merged(command, merge)})"`, cwd), false],
      ["pipeline", (command, merge, cwd) => shell(`${merged(command, merge)} | cat`, cwd), false],
      [
        "file",
        async (command, merge, cwd) => {
          const result = await shell(`${command} ${merge ? "&>" : ">"} out.txt`, cwd);
          return { ...result, stdout: await Bun.file(join(cwd, "out.txt")).text() };
        },
        true,
      ],
      ["bun exec", (command, merge, cwd) => spawned([bunExe(), "exec", merged(command, merge)], cwd), true],
    ];
    // Stdout and stderr of `bun exec` are two descriptors of one pipe here, as they are at a terminal.
    if (isPosix) {
      sinks.push([
        "bun exec with both streams on one pipe",
        (command, merge, cwd) =>
          spawned(["sh", "-c", merge ? 'exec "$0" exec "$1" 2>&1' : 'exec "$0" exec "$1"', bunExe(), command], cwd),
        true,
      ]);
    }
    describe.each([
      ["files", `ls ${shuffledParts}`, false, sortedParts, 0],
      ["files and directories", "ls d2 part-03 d1 part-01", false, "part-01\npart-03\nd1:\nx\nd2:\nx\n", 0],
      [
        "errors on the same stream",
        "ls nope-b part-02 d1 nope-a part-01",
        true,
        noSuchFile("nope-b") + noSuchFile("nope-a") + "part-01\npart-02\nd1:\nx\n",
        1,
      ],
    ])("%s", (_, command, merge, stdout, exitCode) => {
      test.each(sinks)("%s", async (_, sink, fromLs) => {
        using dir = fixture();
        expect(await sink(command, merge, String(dir))).toEqual({
          stdout,
          stderr: "",
          exitCode: fromLs ? exitCode : 0,
        });
      });
    });

    // What `ls -R top` has to print, from the listings in `output`: the section of a directory comes after the
    // listing that names it and before the section of the entry after it (depth first). A listing is in the order
    // of its directory, so the test reads each one from the output. `denied` prints its error and no section.
    // `entries` is every name that the listings have, for a check against the fixture.
    function depthFirst(output: string, denied?: string) {
      const error = `ls: ${denied}: Permission denied`;
      const listings = new Map<string, string[]>([["top", []]]);
      let current = "top";
      for (const line of output.split("\n").slice(0, -1)) {
        if (line === error) continue;
        if (line.endsWith(":")) listings.set((current = line.slice(0, -1)), []);
        else listings.get(current)!.push(line);
      }
      const isDirectory = (path: string) => /^top\/s\d\d(\/t\d\d)?$/.test(path);
      const section = (path: string, header: string): string => {
        if (path === denied) return `${error}\n`;
        const names = listings.get(path) ?? [];
        const subdirectories = names.map(name => `${path}/${name}`).filter(isDirectory);
        return (
          header +
          names.map(name => `${name}\n`).join("") +
          subdirectories.map(sub => section(sub, `${sub}:\n`)).join("")
        );
      };
      return {
        directories: [...listings.keys()].sort(),
        entries: [...listings.values()].flat().sort(),
        expected: section("top", ""),
      };
    }
    const recursiveFixture = () =>
      tempDir("ls-recursive-order", {
        top: {
          f: "",
          ...Object.fromEntries(shuffled.map(i => [`s${two(i)}`, { g: "", [`t${two(i)}`]: { h: "" } }])),
        },
      });
    const recursiveDirectories = (without?: number) =>
      ["top", ...shuffled.flatMap(i => (i === without ? [] : [`top/s${two(i)}`, `top/s${two(i)}/t${two(i)}`]))].sort();
    const recursiveEntries = (without?: number) =>
      ["f", ...shuffled.flatMap(i => [`s${two(i)}`, ...(i === without ? [] : ["g", `t${two(i)}`, "h"])])].sort();

    test("-R lists a directory before its subdirectories", async () => {
      using dir = recursiveFixture();
      const { stdout, stderr, exitCode } = await run("ls -R top", String(dir));
      const output = stdout.replaceAll("\\", "/");
      const { directories, entries, expected } = depthFirst(output);
      expect({ directories, entries, stderr }).toEqual({
        directories: recursiveDirectories(),
        entries: recursiveEntries(),
        stderr: "",
      });
      expect(output).toBe(expected);
      expect(exitCode).toBe(0);
    });

    // The listing is several times what a pipe holds. The reader takes one byte and then waits, so `ls` queues the
    // rest while the pipe is full. `ls` has to stay until the reader has taken the last chunk, and the bytes have to
    // be those of a listing that did not wait.
    test.if(isPosix)("a listing larger than a pipe reaches a reader that stalls", async () => {
      const suffix = Buffer.alloc(230, "x").toString();
      const longNames = Array.from({ length: 100 }, (_, i) => `f${two(i)}${suffix}`);
      const big = Object.fromEntries(longNames.map(name => [name, ""]));
      using dir = tempDir("ls-stalled-reader", {
        top: Object.fromEntries(shuffled.flatMap(i => [[`big${two(i)}`, big] as const, [`small${two(i)}`, { g: "" }]])),
      });
      const [first, go] = [join(String(dir), "first"), join(String(dir), "go")];
      await $`mkfifo ${go}`.quiet().throws(true);
      // Open for both directions: the open does not wait, and the reader finds a byte whenever it comes for it.
      const release = openSync(go, "r+");
      try {
        // The reader copies one byte, makes the file `first`, waits for one byte from `go`, and then copies the rest.
        const reader = 'dd bs=1 count=1 2>/dev/null && : > "$0" && dd bs=1 count=1 < "$1" > /dev/null 2>&1 && cat';
        const stalled = $`ls -R top | sh -c ${reader} ${first} ${go}`.cwd(String(dir)).quiet().run();
        while (!existsSync(first)) await Bun.sleep(1);
        // A second walk of the same tree is complete here, so the first one has queued its listing by now.
        const captured = await run("ls -R top", String(dir));
        writeSync(release, "x");
        const { stdout, exitCode } = await stalled;

        const lines = [
          ...shuffled.flatMap(i => [`big${two(i)}`, `small${two(i)}`, `top/big${two(i)}:`, `top/small${two(i)}:`, "g"]),
          ...shuffled.flatMap(() => longNames),
        ];
        expect(captured.stdout.split("\n").slice(0, -1).sort()).toEqual(lines.sort());
        expect(captured.stdout.length).toBeGreaterThan(4 * 65536);
        expect(stdout.toString()).toBe(captured.stdout);
        expect(exitCode).toBe(0);
      } finally {
        closeSync(release);
      }
    });

    // Stdout is a file, and stderr is a pipe that is full, so the errors cannot be written yet. The listing must not
    // wait for them: a reader that does not drain one stream must not stop the other stream.
    test.if(isPosix)("a stream does not wait for the other one when they go to two places", async () => {
      using dir = fixture();
      const [errors, out] = [join(String(dir), "errors"), join(String(dir), "out.txt")];
      await $`mkfifo ${errors}`.quiet().throws(true);
      const wouldBlock = (e: unknown) => {
        if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
      };
      // The test is the reader of the pipe, and fills it first. This descriptor does not block.
      const pipe = openSync(errors, constants.O_RDWR | constants.O_NONBLOCK);
      try {
        let filled = 0;
        for (const block of [Buffer.alloc(4096, "#"), Buffer.alloc(1, "#")]) {
          try {
            for (;;) filled += writeSync(pipe, block);
          } catch (e) {
            wouldBlock(e);
          }
        }
        const stderr = openSync(errors, "w");
        await using proc = Bun.spawn({
          cmd: [bunExe(), "exec", `ls nope-b ${shuffledParts} nope-a > out.txt`],
          env: bunEnv,
          cwd: String(dir),
          stdout: "ignore",
          stderr,
        });
        closeSync(stderr);

        // The listing is in the file while the errors still wait for room in the pipe.
        const listing = () => (existsSync(out) ? readFileSync(out, "utf8") : "");
        while (listing().length < sortedParts.length) await Bun.sleep(1);
        const early = listing();

        const chunks: Buffer[] = [];
        const read = () => {
          const buffer = Buffer.alloc(65536);
          try {
            for (let n; (n = readSync(pipe, buffer)) > 0;) chunks.push(Buffer.from(buffer.subarray(0, n)));
          } catch (e) {
            wouldBlock(e);
          }
        };
        read();
        const exitCode = await proc.exited;
        read();
        expect({ early, errors: Buffer.concat(chunks).toString().slice(filled), exitCode }).toEqual({
          early: sortedParts,
          errors: noSuchFile("nope-b") + noSuchFile("nope-a"),
          exitCode: 1,
        });
      } finally {
        closeSync(pipe);
      }
    });

    // The error of a directory that does not open is where the section of that directory would be. `ls` runs in a
    // child that is not root, so that the mode bits apply to it.
    describe.if(isPosix)("a directory that does not open", () => {
      const child = async (cmd: string[], dir: string, locked: string) => {
        using options = unprivilegedSpawnOptions(dir);
        chmodSync(join(dir, locked), 0o000);
        try {
          await using proc = Bun.spawn({ cmd, env: bunEnv, cwd: dir, stdout: "pipe", stderr: "pipe", ...options });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stdout, stderr, exitCode };
        } finally {
          chmodSync(join(dir, locked), 0o755);
        }
      };
      // With two descriptors of one pipe, `ls` has a writer for each stream, as it has at a terminal.
      const oneDestination: [name: string, cmd: (line: string) => string[]][] = [
        ["on one stream", line => [bunExe(), "exec", `${line} 2>&1`]],
        ["on two descriptors of one pipe", line => ["sh", "-c", 'exec "$0" exec "$1" 2>&1', bunExe(), line]],
      ];

      test("as an operand, on two streams", async () => {
        using dir = fixture();
        expect(await child([bunExe(), "exec", "ls d3 d2 part-01 d1"], String(dir), "d2")).toEqual({
          stdout: "part-01\nd1:\nx\nd3:\nx\n",
          stderr: "ls: d2: Permission denied\n",
          exitCode: 1,
        });
      });

      test.each(oneDestination)("as an operand, %s", async (_, cmd) => {
        using dir = fixture();
        expect(await child(cmd("ls d3 d2 part-01 d1"), String(dir), "d2")).toEqual({
          stdout: "part-01\nd1:\nx\nls: d2: Permission denied\nd3:\nx\n",
          stderr: "",
          exitCode: 1,
        });
      });

      test.each(oneDestination)("under -R, %s", async (_, cmd) => {
        using dir = recursiveFixture();
        const { stdout, stderr, exitCode } = await child(cmd("ls -R top"), String(dir), "top/s05");
        const { directories, entries, expected } = depthFirst(stdout, "top/s05");
        expect({ directories, entries, stderr, exitCode }).toEqual({
          directories: recursiveDirectories(5),
          entries: recursiveEntries(5),
          stderr: "",
          exitCode: 1,
        });
        expect(stdout).toBe(expected);
      });
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
