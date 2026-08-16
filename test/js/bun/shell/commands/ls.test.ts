import { $ } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { DirectoryTree, isPosix, tempDir, tempDirWithFiles } from "harness";
import { symlinkSync } from "node:fs";
import { join, posix } from "node:path";
import { createTestBuilder, nodeModulesTree } from "../util";
const TestBuilder = createTestBuilder(import.meta.path);

const fileExists = async (path: string): Promise<boolean> =>
  $`ls -d ${path}`.then(o => o.stdout.toString() === `${path}\n`);

$.nothrow();

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

/**
 * What `ls -RA .` prints for a directory created from `tree`, in `sortedLsOutput`
 * form: every file and directory once under its parent, plus a `./dir:` header for
 * every directory below the root. Values in these trees are file contents or `{}`
 * for an empty directory.
 */
const expectedRecursiveListing = (tree: DirectoryTree): string[] => {
  const paths = new Set<string>();
  const dirs = new Set<string>();
  for (const [file, contents] of Object.entries(tree)) {
    const parts = file.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length; i++) {
      prefix = i === 0 ? parts[0] : `${prefix}/${parts[i]}`;
      paths.add(prefix);
      if (i < parts.length - 1 || typeof contents !== "string") dirs.add(prefix);
    }
  }
  return [...Array.from(paths, p => posix.basename(p)), ...Array.from(dirs, dir => `./${dir}:`)].sort();
};

describe.concurrent("bunshell ls", () => {
  beforeAll(async () => {
    tempdir = tempDirWithFiles("ls", {});
    await $`touch a b c; mkdir foo; touch foo/a foo/b foo/c`.quiet().throws(true).cwd(tempdir);

    allFiles = ["./foo:", "a", "a", "b", "b", "c", "c", "foo"];
  });

  describe("recursive", () => {
    test("node_modules", async () => {
      const tree: DirectoryTree = { ...nodeModulesTree(), "outside/keep.txt": "" };
      using dir = tempDir("ls-node_modules", tree);
      // A link to a directory is listed but not descended into ("junction" is
      // ignored on POSIX and needs no privilege on Windows).
      symlinkSync("../outside", join(String(dir), "node_modules", "linked"), "junction");
      const expected = [...expectedRecursiveListing(tree), "linked"].sort();

      const { stdout, stderr, exitCode } = await $`ls -RA .`.quiet().cwd(String(dir));
      expect(stderr.toString()).toBe("");
      expect(sortedLsOutput(stdout.toString())).toEqual(expected);
      expect(exitCode).toBe(0);
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

    test.if(isPosix)("permission denied directory", async () => {
      await using tempdir = tempDir("ls-permission", {});
      await $`mkdir restricted; chmod 000 restricted`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls restricted`
        .setTempdir(tempdir)
        .exitCode(1)
        .stderr(s => expect(s).toContain("Permission denied"))
        .run();
      await $`chmod 755 restricted`.quiet().throws(true).cwd(tempdir); // cleanup
    });

    test.if(isPosix)("permission denied directory recursive", async () => {
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

    test.if(isPosix)("broken symlink file", async () => {
      await using tempdir = tempDir("ls-broken-symlink", {});
      await $`touch will-remove; ln -s will-remove broken-link; rm will-remove`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls broken-link`
        .exitCode(1)
        .stderr("ls: broken-link: No such file or directory\n")
        .setTempdir(tempdir)
        .run();
    });

    test.if(isPosix)("broken symlink directory", async () => {
      await using tempdir = tempDir("ls-broken-symlink", {});
      await $`mkdir will-remove; ln -s will-remove broken-link; rm -rf will-remove`.quiet().throws(true).cwd(tempdir);
      await TestBuilder.command`ls broken-link`
        .exitCode(1)
        .stderr("ls: broken-link: No such file or directory\n")
        .setTempdir(tempdir)
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
