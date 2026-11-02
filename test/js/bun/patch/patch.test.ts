import { $ } from "bun";
import { patchInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import { tempDirWithFiles as __tempDirWithFiles, bunEnv, bunExe, tempDir } from "harness";
import { join as __join } from "node:path";
const { parse, apply, makeDiff } = patchInternals;

const makeDiffJs = async (aFolder: string, bFolder: string, cwd: string): Promise<string> => {
  const { stdout, stderr } =
    await $`git -c core.safecrlf=false -c core.quotepath=false diff --src-prefix=a/ --dst-prefix=b/ --ignore-cr-at-eol --irreversible-delete --full-index --no-index ${aFolder} ${bFolder}`
      .env(
        // https://github.com/pnpm/pnpm/blob/45f4262f0369cadf41cea3b823e8932eae157c4b/patching/plugin-commands-patching/src/patchCommit.ts#L117
        {
          ...process.env,
          // #region Predictable output
          // These variables aim to ignore the global git config so we get predictable output
          // https://git-scm.com/docs/git#Documentation/git.txt-codeGITCONFIGNOSYSTEMcode
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_ATTR_NOSYSTEM: "1",
          HOME: "",
          XDG_CONFIG_HOME: "",
          USERPROFILE: "",
          GIT_DIR: "/dev/null",
        },
      )
      .quiet()
      .cwd(cwd)
      // For some reason git diff returns exit code 1 when it is not an error
      // So we must check that there is no stderr output instead of the exit code
      // to determine if the command was successful
      .throws(false);

  if (stderr.length > 0) throw new Error(stderr.toString());

  const patch = stdout.toString();

  return patch
    .replace(new RegExp(`(a|b)(${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(aFolder)}/`)})`, "g"), "$1/")
    .replace(new RegExp(`(a|b)${escapeStringRegexp(`/${removeTrailingAndLeadingSlash(bFolder)}/`)}`, "g"), "$1/")
    .replace(new RegExp(escapeStringRegexp(`${aFolder}/`), "g"), "")
    .replace(new RegExp(escapeStringRegexp(`${bFolder}/`), "g"), "");
  // .replace(/\n\\ No newline at end of file\n$/, "\n");
};

const tempDirWithFiles: typeof __tempDirWithFiles =
  process.platform === "win32"
    ? (a, b) => __tempDirWithFiles(a.replaceAll("\\", "/"), b).replaceAll("\\", "/")
    : __tempDirWithFiles;
const join =
  process.platform === "win32"
    ? (...strings: string[]): string => __join(...strings.map(s => s.replaceAll("\\", "/"))).replaceAll("\\", "/")
    : __join;

// Recurse through a nested object, and return a copy where for any object where the only two
// properties are a numeric `capacity` and an array `items`, the capacity has been deleted. Meant to
// be used on serialized Zig structs that contain ArrayLists, because the allocation strategy of
// ArrayList can change and result in a different `capacity` without changing the interpretation of
// the ArrayList's value.
function removeCapacity(patch: any): any {
  if (Array.isArray(patch)) {
    return patch.map(removeCapacity);
  } else if (patch !== null && typeof patch == "object") {
    const keys = Object.keys(patch);
    keys.sort();
    if (keys.length == 2 && keys[0] == "capacity" && keys[1] == "items") {
      if (typeof patch.capacity == "number" && Array.isArray(patch.items)) {
        // this looks like an ArrayList, so delete the capacity because it is unstable
        return { items: patch.items.map(removeCapacity) };
      }
    }
    // ordinary object, so just apply to all the children
    const result = {};
    for (const k of keys) {
      result[k] = removeCapacity(patch[k]);
    }
    return result;
  }
  return patch;
}

describe("apply", () => {
  test("edgecase", async () => {
    const oldcontents = "module.exports = x => x % 2 === 0;";
    const newcontents = "module.exports = x => x % 420 === 0;";
    await using tempdir2 = tempDir("patch-test2", {
      ".bun/install/cache/is-even@1.0.0": {
        "index.js": oldcontents,
      },
    });
    await using tempdir = tempDir("patch-test", {
      a: {},
      ["node_modules/is-even"]: {
        "index.js": newcontents,
      },
    });

    const patchfile = await makeDiff(
      `${tempdir2}/.bun/install/cache/is-even@1.0.0`,
      `${tempdir}/node_modules/is-even`,
      tempdir,
    );

    // apply against the original (cache) contents, as `bun install` does
    await using targetdir = tempDir("patch-test-target", {
      "index.js": oldcontents,
    });
    await apply(patchfile, String(targetdir));
    expect(await fs.readFile(`${targetdir}/index.js`, "utf8")).toBe(newcontents);
  });

  test("empty", async () => {
    await using tempdir = tempDir("patch-test", {
      a: {},
      b: {},
    });

    const afolder = join(tempdir, "a");
    const bfolder = join(tempdir, "b");

    const patchfile = await makeDiff(afolder, bfolder, tempdir);
    expect(patchfile).toBe("");

    await apply(patchfile, afolder);

    expect(await fs.readdir(afolder)).toEqual([]);
  });

  describe("deletion", () => {
    test("simple", async () => {
      const files = {
        "a/hey.txt": "hello!",
        "a/byebye.txt": "goodbye :(",
        "b/hey.txt": "hello!",
      };
      await using tempdir = tempDir("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      console.log("makeDiff args", afolder, bfolder);
      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      console.log("PATCHFILE", patchfile);
      console.log("afolder", afolder);
      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hey.txt")}`.cwd(tempdir).text()).toBe(files["b/hey.txt"]);
      expect(
        await $`if ls -d ${join(afolder, "byebye.txt")}; then echo oops; else echo okay!; fi;`.cwd(tempdir).text(),
      ).toBe("okay!\n");
    });
  });

  describe("creation", () => {
    test("simple", async () => {
      const files = {
        "a": {},
        "b/newfile.txt": "hey im new here!",
      };
      await using tempdir = tempDir("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "newfile.txt")}`.cwd(tempdir).text()).toBe(files["b/newfile.txt"]);
    });

    test("multi-line", async () => {
      const files = {
        "a": {},
        "b/newfile.txt": "hey im new here!\nhello",
      };
      await using tempdir = tempDir("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "newfile.txt")}`.cwd(tempdir).text()).toBe(files["b/newfile.txt"]);
    });

    // The header mode belongs to the file; directories the patch has to create
    // must be traversable regardless, or the file cannot be created inside them.
    test.if(process.platform !== "win32")("creates missing parent directories traversable", async () => {
      await using tempdir = tempDir("patch-test", { "a/.keep": "" });
      const afolder = join(tempdir, "a");

      const patch =
        "diff --git a/newdir/sub/new.txt b/newdir/sub/new.txt\n" +
        "new file mode 100644\n" +
        "--- /dev/null\n" +
        "+++ b/newdir/sub/new.txt\n" +
        "@@ -0,0 +1,1 @@\n" +
        "+hello\n";

      await apply(patch, afolder);
      const dirMode = (await fs.stat(join(afolder, "newdir"))).mode;
      const fileMode = (await fs.stat(join(afolder, "newdir", "sub", "new.txt"))).mode;
      expect({
        contents: await fs.readFile(join(afolder, "newdir", "sub", "new.txt"), "utf8"),
        dirOwnerExec: (dirMode & 0o100) !== 0,
        fileOwnerExec: (fileMode & 0o100) !== 0,
      }).toEqual({ contents: "hello\n", dirOwnerExec: true, fileOwnerExec: false });
    });
  });

  describe("rename", () => {
    test("files", async () => {
      const files = {
        "a/hey.txt": "hello!",
        "b/heynow.txt": "hello!",
      };
      await using tempdir = tempDir("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "heynow.txt")}`.cwd(tempdir).text()).toBe(files["b/heynow.txt"]);
      expect(
        await $`if ls -d ${join(afolder, "hey.txt")}; then echo oops; else echo okay!; fi;`.cwd(tempdir).text(),
      ).toBe("okay!\n");
    });

    test("to a destination dir longer than the path buffer throws instead of crashing", async () => {
      await using tempdir = tempDir("patch-test", { "from.txt": "hello!" });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { patchInternals } from "bun:internal-for-testing";
           const hugeDir = Buffer.alloc(8000, "a").toString();
           const patchfile = "rename from from.txt\\nrename to " + hugeDir + "/to.txt\\n";
           try {
             patchInternals.apply(patchfile, ${JSON.stringify(tempdir)});
             console.log("no-error");
           } catch (e) {
             console.log("caught: " + e.code);
           }`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      if (process.platform !== "win32") {
        expect(stdout.trim()).toBe("caught: ENAMETOOLONG");
      } else {
        expect(stdout.trim()).toStartWith("caught:");
      }
      expect(exitCode).toBe(0);
    });

    test("to a path containing a NUL byte throws EINVAL and leaves the source in place", async () => {
      const tempdir = tempDirWithFiles("patch-test", { "from.txt": "hello!" });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { patchInternals } from "bun:internal-for-testing";
           import { existsSync } from "node:fs";
           const dir = ${JSON.stringify(tempdir)};
           const patchfile = "rename from from.txt\\nrename to to\\u0000.txt\\n";
           try {
             patchInternals.apply(patchfile, dir);
             console.log("no-error");
           } catch (e) {
             console.log("caught: " + e.code);
           }
           console.log("from-exists: " + existsSync(dir + "/from.txt"));`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim().split("\n")).toEqual(["caught: EINVAL", "from-exists: true"]);
      expect(exitCode).toBe(0);
    });

    test("folders", async () => {
      const files = {
        "a/foo/hey.txt": "hello!",
        "a/foo/hi.txt": "hello!",
        "a/foo/lmao.txt": "lmao!",
        "b/foo": {},
        "b/bar/hey.txt": "hello!",
        "b/bar/hi.txt": "hello!",
        "b/bar/lmao.txt": "lmao!",
      };
      await using tempdir = tempDir("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      // Should we remove the folder if it's empty? Technically running `git apply` does this
      // But git does not track empty directories so it's not really a problem
      // expect(
      //   await $`if ls -d ${join(afolder, "foo")}; then echo should not exist!; else echo okay!; fi;`
      //     .cwd(tempdir)
      //     .text(),
      // ).toBe("okay!\n");

      expect(await $`cat ${join(afolder, "bar", "hey.txt")}`.cwd(tempdir).text()).toBe(files["b/bar/hey.txt"]);
      expect(await $`cat ${join(afolder, "bar", "hi.txt")}`.cwd(tempdir).text()).toBe(files["b/bar/hi.txt"]);
      expect(await $`cat ${join(afolder, "bar", "lmao.txt")}`.cwd(tempdir).text()).toBe(files["b/bar/lmao.txt"]);
      expect(
        await $`ls ${join(afolder, "bar")}`
          .cwd(tempdir)
          .text()
          .then((out: string) =>
            out
              .split("\n")
              .filter(x => x !== "")
              .sort(),
          ),
      ).toEqual(["hey.txt", "hi.txt", "lmao.txt"].sort());
    });
  });

  describe("mode change", () => {
    // chmod doesn't do anything on windows so skiip
    test.if(process.platform !== "win32")("simple", async () => {
      const files = {
        "a/hi.txt": "hello!",
        "b/hi.txt": "hi!",
      };

      await using tempdir = tempDir("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      await fs.chmod(join(bfolder, "hi.txt"), 0o755);

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hi.txt")}`.cwd(tempdir).text()).toBe(files["b/hi.txt"]);
      const stat = await fs.stat(join(afolder, "hi.txt"));
      expect((stat.mode & parseInt("777", 8)).toString(8)).toBe("755");
    });
  });

  // `diff --git a/plan b/notes.js b/plan b/notes.js` is the only line with the name of a deleted file, of an
  // empty new file and of a mode change, and it has ` b/` three times.
  test("files in a folder whose name ends in ' b'", async () => {
    await using tempdir = tempDir("patch-test", {
      "a/plan": "keep me\n",
      "a/plan b/notes.js": "old notes\n",
      "a/plan b/run.sh": "#!/bin/sh\n",
      "b/plan": "keep me\n",
      "b/plan b/todo.js": "new file\n",
      "b/plan b/empty.js": "",
      "b/plan b/run.sh": "#!/bin/sh\n",
    });
    const afolder = join(tempdir, "a");
    const bfolder = join(tempdir, "b");
    await fs.chmod(join(bfolder, "plan b", "run.sh"), 0o755);

    await apply(await makeDiff(afolder, bfolder, tempdir), afolder);

    const tree = (await fs.readdir(afolder, { recursive: true })).map(path => path.replaceAll("\\", "/")).sort();
    expect(tree).toEqual(["plan", "plan b", "plan b/empty.js", "plan b/run.sh", "plan b/todo.js"]);
    expect(await fs.readFile(join(afolder, "plan b", "todo.js"), "utf8")).toBe("new file\n");
    if (process.platform !== "win32") {
      expect((await fs.stat(join(afolder, "plan b", "run.sh"))).mode & 0o777).toBe(0o755);
    }
  });

  describe("patch", () => {
    test("simple insertion", async () => {
      const afile = `hello!\n`;
      const bfile = `hello!\nwassup?\n`;

      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
        "b/hello.txt": bfile,
      });

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hello.txt")}`.cwd(tempdir).text()).toBe(bfile);
    });

    test("simple deletion", async () => {
      const afile = `hello!\nwassup?\n`;
      const bfile = `hello!\n`;

      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
        "b/hello.txt": bfile,
      });

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hello.txt")}`.cwd(tempdir).text()).toBe(bfile);
    });

    test("multi insertion", async () => {
      const afile = `hello!\n`;
      const bfile = `lol\nhello!\nwassup?\n`;

      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
        "b/hello.txt": bfile,
      });

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hello.txt")}`.cwd(tempdir).text()).toBe(bfile);
    });

    test("multi deletion", async () => {
      const afile = `hello!\nwassup?\nlmao\n`;
      const bfile = `wassup?\n`;

      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
        "b/hello.txt": bfile,
      });

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hello.txt")}`.cwd(tempdir).text()).toBe(bfile);
    });

    test("multi-hunk insertion", async () => {
      const afile = `0
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20`;
      const bfile = `0
0.5 hi
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
19.5 lol hi
20`;

      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
        "b/hello.txt": bfile,
      });

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hello.txt")}`.cwd(tempdir).text()).toBe(bfile);
    });

    test("multi-hunk deletion", async () => {
      const bfile = `0
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20`;
      const afile = `0
0.5 hi
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
19.5 lol hi
20`;

      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
        "b/hello.txt": bfile,
      });

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hello.txt")}`.cwd(tempdir).text()).toBe(bfile);
    });

    // Patches produced by `yarn patch-commit` often have `+` start lines that
    // don't account for lines added by earlier hunks. Hunks must be located by
    // matching their `-` side context (like `git apply`), not by trusting the
    // stated `+` offset.
    test("hunk with stale + start line is placed by context", async () => {
      const afile = Array.from({ length: 12 }, (_, i) => `line${String(i + 1).padStart(2, "0")}`).join("\n") + "\n";
      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
      });
      const afolder = join(tempdir, "a");

      // Hunk 1 adds 2 lines, so hunk 2's correct `+` start is 9. The header
      // says 7 (stale), exactly as yarn patch-commit emits.
      const patchfile = [
        "diff --git a/hello.txt b/hello.txt",
        "--- a/hello.txt",
        "+++ b/hello.txt",
        "@@ -1,4 +1,6 @@",
        " line01",
        " line02",
        "+INSERT-ONE",
        "+INSERT-TWO",
        " line03",
        " line04",
        "@@ -7,6 +7,7 @@",
        " line07",
        " line08",
        "-line09",
        "+line09-changed",
        "+SECOND-MARKER",
        " line10",
        " line11",
        " line12",
        "",
      ].join("\n");

      await apply(patchfile, afolder);

      expect(await fs.readFile(join(afolder, "hello.txt"), "utf8")).toBe(
        [
          "line01",
          "line02",
          "INSERT-ONE",
          "INSERT-TWO",
          "line03",
          "line04",
          "line05",
          "line06",
          "line07",
          "line08",
          "line09-changed",
          "SECOND-MARKER",
          "line10",
          "line11",
          "line12",
          "",
        ].join("\n"),
      );
    });

    test("hunk whose context matches nowhere fails instead of corrupting the file", async () => {
      const afile = Array.from({ length: 30 }, (_, i) => `alpha${i}`).join("\n") + "\n";
      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
      });
      const afolder = join(tempdir, "a");

      const patchfile = [
        "diff --git a/hello.txt b/hello.txt",
        "--- a/hello.txt",
        "+++ b/hello.txt",
        "@@ -1,3 +1,4 @@",
        " not-in-file-1",
        " not-in-file-2",
        "+NEW-LINE",
        " not-in-file-3",
        "",
      ].join("\n");

      expect(() => apply(patchfile, afolder)).toThrow("hunk #1 does not apply to hello.txt (expected at line 1)");
      // the file must be left untouched
      expect(await fs.readFile(join(afolder, "hello.txt"), "utf8")).toBe(afile);
    });

    test("a later hunk that matches nowhere fails before anything is written", async () => {
      const afile = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
      await using tempdir = tempDir("patch-test", {
        "a/sub/hello.txt": afile,
      });
      const afolder = join(tempdir, "a");

      const patchfile = [
        "diff --git a/sub/hello.txt b/sub/hello.txt",
        "--- a/sub/hello.txt",
        "+++ b/sub/hello.txt",
        "@@ -1,2 +1,3 @@",
        " line1",
        "+FIRST",
        " line2",
        "@@ -8,2 +9,3 @@",
        " line8",
        "+SECOND",
        " not-line9",
        "",
      ].join("\n");

      expect(() => apply(patchfile, afolder)).toThrow("hunk #2 does not apply to sub/hello.txt (expected at line 8)");
      expect(await fs.readFile(join(afolder, "sub", "hello.txt"), "utf8")).toBe(afile);
    });

    test("hunk is found by context when the file shifted by more than 20 lines", async () => {
      const afile = Array.from({ length: 60 }, (_, i) => (i === 49 ? "target" : `filler${i + 1}`)).join("\n") + "\n";
      await using tempdir = tempDir("patch-test", {
        "a/hello.txt": afile,
      });
      const afolder = join(tempdir, "a");

      // The patch was made when "target" was line 2. It is now line 50.
      const patchfile = [
        "diff --git a/hello.txt b/hello.txt",
        "--- a/hello.txt",
        "+++ b/hello.txt",
        "@@ -1,3 +1,3 @@",
        " filler49",
        "-target",
        "+replaced",
        " filler51",
        "",
      ].join("\n");

      await apply(patchfile, afolder);

      const lines = (await fs.readFile(join(afolder, "hello.txt"), "utf8")).split("\n");
      expect({ line49: lines[48], line50: lines[49], line51: lines[50], count: lines.length }).toEqual({
        line49: "filler49",
        line50: "replaced",
        line51: "filler51",
        count: 61,
      });
    });

    test("two hunks with the same context each change the copy their header names", async () => {
      using dir = tempDir("patch-dup", { "index.js": "s\ndup\ne\ns\ndup\ne\n" });
      const patchfile =
        "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n" +
        "@@ -1,3 +1,4 @@\n s\n-dup\n+ONE\n+MORE\n e\n@@ -4,3 +5,3 @@\n s\n-dup\n+TWO\n e\n";
      await apply(patchfile, String(dir));
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe("s\nONE\nMORE\ne\ns\nTWO\ne\n");
    });

    test("an LF patch applies to a CRLF file", async () => {
      using dir = tempDir("patch-crlf", { "index.js": "a\r\nb\r\nc\r\n" });
      const patchfile =
        "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1,3 +1,2 @@\n a\n-b\n c\n";
      await apply(patchfile, String(dir));
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe("a\r\nc\r\n");
    });

    // `git diff -U0` emits hunks with no context lines. A zero-length range
    // (`-3,0`, `+5,0`) names the line the gap sits after, and `0` is the top
    // of the file. Every case below is what `git apply --unidiff-zero` produces.
    const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    test.each([
      [
        "delete one line",
        numbered(8),
        "@@ -6 +5,0 @@\n-line 6\n",
        "line 1\nline 2\nline 3\nline 4\nline 5\nline 7\nline 8\n",
      ],
      [
        "delete a run of lines",
        numbered(8),
        "@@ -3,3 +2,0 @@\n-line 3\n-line 4\n-line 5\n",
        "line 1\nline 2\nline 6\nline 7\nline 8\n",
      ],
      ["delete the first line", numbered(3), "@@ -1 +0,0 @@\n-line 1\n", "line 2\nline 3\n"],
      ["delete the last line", numbered(3), "@@ -3 +2,0 @@\n-line 3\n", "line 1\nline 2\n"],
      [
        "two deletions",
        numbered(8),
        "@@ -2 +1,0 @@\n-line 2\n@@ -6 +4,0 @@\n-line 6\n",
        "line 1\nline 3\nline 4\nline 5\nline 7\nline 8\n",
      ],
      ["insert after a line", numbered(4), "@@ -3,0 +4,2 @@\n+X\n+Y\n", "line 1\nline 2\nline 3\nX\nY\nline 4\n"],
      ["insert at the top", numbered(2), "@@ -0,0 +1 @@\n+X\n", "X\nline 1\nline 2\n"],
      ["insert at the end", numbered(2), "@@ -2,0 +3 @@\n+X\n", "line 1\nline 2\nX\n"],
      ["replace a line", numbered(3), "@@ -2 +2 @@\n-line 2\n+TWO\n", "line 1\nTWO\nline 3\n"],
      [
        "delete then insert",
        numbered(6),
        "@@ -2 +1,0 @@\n-line 2\n@@ -5,0 +5 @@\n+X\n",
        "line 1\nline 3\nline 4\nline 5\nX\nline 6\n",
      ],
      [
        "insert then insert",
        numbered(4),
        "@@ -1,0 +2,2 @@\n+A\n+B\n@@ -3,0 +6 @@\n+C\n",
        "line 1\nA\nB\nline 2\nline 3\nC\nline 4\n",
      ],
    ])("zero-context hunk: %s", async (_name, before, hunks, after) => {
      using dir = tempDir("patch-u0", { "index.js": before });
      const patchfile = `diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n${hunks}`;
      await apply(patchfile, String(dir));
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe(after);
    });

    test("a pure insertion past the end of the file does not apply", async () => {
      using dir = tempDir("patch-u0", { "index.js": "line 1\nline 2\n" });
      const header = "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n";
      expect(() => apply(header + "@@ -9,0 +10 @@\n+X\n", String(dir))).toThrow(
        "hunk #1 does not apply to index.js (expected at line 9)",
      );
      // One past the last line: the file has 2 lines, there is no line 3 to insert after.
      expect(() => apply(header + "@@ -3,0 +4 @@\n+X\n", String(dir))).toThrow(
        "hunk #1 does not apply to index.js (expected at line 3)",
      );
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe("line 1\nline 2\n");
    });

    // `\ No newline at end of file` ends that side of the file, so context or
    // deleted lines after it are malformed. These used to crash or drop a line.
    test.each([
      ["deletion after it", "line 1\nline 2", "@@ -1,2 +1,1 @@\n+X\n\\ No newline at end of file\n-line 1\n-line 2\n"],
      ["context after it", "line 1\nline 2", "@@ -1,2 +1,3 @@\n+X\n\\ No newline at end of file\n line 1\n line 2\n"],
      [
        "context after it, trailing newline",
        "line 1\nline 2\n",
        "@@ -1,2 +1,3 @@\n+X\n\\ No newline at end of file\n line 1\n line 2\n",
      ],
      [
        "context after a deletion with it",
        "line 1\nline 2",
        "@@ -1,2 +1,1 @@\n-line 1\n\\ No newline at end of file\n line 2\n",
      ],
    ])("a no-newline pragma with %s does not apply", async (_name, before, hunk) => {
      using dir = tempDir("patch-pragma", { "index.js": before });
      const patchfile = `diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n${hunk}`;
      expect(() => apply(patchfile, String(dir))).toThrow("hunk #1 does not apply to index.js (expected at line 1)");
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe(before);
    });

    test.each([
      [
        "old side had no newline",
        "a\nb",
        "@@ -1,2 +1,3 @@\n a\n-b\n\\ No newline at end of file\n+b\n+c\n",
        "a\nb\nc\n",
      ],
      [
        "new side has no newline",
        "a\nb\nc\n",
        "@@ -1,3 +1,2 @@\n a\n-b\n-c\n+b\n\\ No newline at end of file\n",
        "a\nb",
      ],
      [
        "neither side has a newline",
        "a\nb",
        "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n",
        "a\nB",
      ],
      [
        "unchanged last line without newline",
        "a\nb",
        "@@ -1,2 +1,3 @@\n+X\n a\n b\n\\ No newline at end of file\n",
        "X\na\nb",
      ],
      // With `--ignore-cr-at-eol` a line that only gains or loses its newline is context, printed from the new file.
      [
        "last lines deleted, neither side has a newline",
        "one\ntwo\nthree",
        "@@ -1,3 +1 @@\n one\n\\ No newline at end of file\n-two\n-three\n\\ No newline at end of file\n",
        "one",
      ],
      [
        "last line deleted, old side had a newline",
        "a\nb\n",
        "@@ -1,2 +1 @@\n a\n\\ No newline at end of file\n-b\n",
        "a",
      ],
      [
        "lines appended, neither side has a newline",
        "one",
        "@@ -1 +1,3 @@\n one\n+two\n+three\n\\ No newline at end of file\n",
        "one\ntwo\nthree",
      ],
      ["lines appended, new side has a newline", "one", "@@ -1 +1,2 @@\n one\n+two\n", "one\ntwo\n"],
      [
        "unchanged last line loses its newline",
        "a\nb\n",
        "@@ -1,2 +1,2 @@\n-a\n+A\n b\n\\ No newline at end of file\n",
        "A\nb",
      ],
      ["unchanged last line gains a newline", "a\nb", "@@ -1,2 +1,2 @@\n-a\n+A\n b\n", "A\nb\n"],
    ])("a no-newline pragma where git puts it applies: %s", async (_name, before, hunk, after) => {
      using dir = tempDir("patch-pragma", { "index.js": before });
      const patchfile = `diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n${hunk}`;
      await apply(patchfile, String(dir));
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe(after);
    });

    test("a header start far past the end of the file is still found or rejected quickly", async () => {
      using dir = tempDir("patch-far", { "index.js": "line 1\nline 2\nline 3\n" });
      const header = "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n";
      await apply(header + "@@ -4000000000 +4000000000 @@\n-line 2\n+TWO\n", String(dir));
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe("line 1\nTWO\nline 3\n");
      expect(() => apply(header + "@@ -4000000000 +4000000000 @@\n-nowhere\n+X\n", String(dir))).toThrow(
        "hunk #1 does not apply to index.js (expected at line 4000000000)",
      );
    });

    // Of every 10 lines one is edited, one added and one deleted. The time has to grow with the number of
    // lines, not with lines x changes: that took 30 seconds here.
    test("a patch that changes 80,000 lines of a 200,000-line file", async () => {
      const before: string[] = [];
      const after: string[] = [];
      const hunk: string[] = [];
      for (let i = 0; i < 200_000; i++) {
        const line = `const v${i} = ${i};`;
        before.push(line);
        if (i % 10 === 0) {
          after.push(`${line} // x`, "// added");
          hunk.push(`-${line}`, `+${line} // x`, "+// added");
        } else if (i % 10 === 5) {
          hunk.push(`-${line}`);
        } else {
          after.push(line);
          hunk.push(` ${line}`);
        }
      }
      using dir = tempDir("patch-large", { "index.js": before.join("\n") + "\n" });
      const header = `diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1,${before.length} +1,${after.length} @@\n`;
      await apply(header + hunk.join("\n") + "\n", String(dir));
      expect((await fs.readFile(join(String(dir), "index.js"), "utf8")) === after.join("\n") + "\n").toBe(true);
    });

    // No tool writes these, but a patch file merged by hand can have them. Every case is what `git apply` produces.
    test.each([
      [
        "two swapped",
        "@@ -6 +6 @@\n-line 6\n+SIX\n@@ -2 +2 @@\n-line 2\n+TWO\n",
        "line 1\nTWO\nline 3\nline 4\nline 5\nSIX\nline 7\nline 8\n",
      ],
      [
        "three rotated",
        "@@ -4 +4 @@\n-line 4\n+FOUR\n@@ -6 +6 @@\n-line 6\n+SIX\n@@ -2 +2 @@\n-line 2\n+TWO\n",
        "line 1\nTWO\nline 3\nFOUR\nline 5\nSIX\nline 7\nline 8\n",
      ],
      [
        "two swapped that change the number of lines",
        "@@ -5,4 +7,2 @@\n line 5\n-line 6\n-line 7\n line 8\n@@ -2,2 +2,4 @@\n line 2\n+A\n+B\n line 3\n",
        "line 1\nline 2\nA\nB\nline 3\nline 4\nline 5\nline 8\n",
      ],
      [
        "two swapped that change the number of lines, no context",
        "@@ -6,2 +8,0 @@\n-line 6\n-line 7\n@@ -2,0 +3,2 @@\n+A\n+B\n",
        "line 1\nline 2\nA\nB\nline 3\nline 4\nline 5\nline 8\n",
      ],
    ])("hunks that are not in rising order: %s", async (_name, hunks, after) => {
      using dir = tempDir("patch-order", { "index.js": numbered(8) });
      await apply(`diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n${hunks}`, String(dir));
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe(after);
    });

    test("hunks that overlap do not apply, and the error has the hunk's number in the file", async () => {
      using dir = tempDir("patch-order", { "index.js": numbered(8) });
      const patchfile =
        "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n" +
        "@@ -4,2 +4,2 @@\n-line 4\n+Y\n line 5\n@@ -2,3 +2,3 @@\n line 2\n-line 3\n+X\n line 4\n";
      expect(() => apply(patchfile, String(dir))).toThrow("hunk #1 does not apply to index.js (expected at line 4)");
      expect(await fs.readFile(join(String(dir), "index.js"), "utf8")).toBe(numbered(8));
    });
  });

  describe("No newline at end of file", () => {
    // TODO: simple, multiline, multiple hunks
  });

  // Each of these hits an error path in `apply`. The native code must
  // surface the failure as a catchable JS exception; it used to return a normal
  // value while the exception was still pending, which aborts debug/ASAN builds
  // with "Unexpected exception observed" (releaseAssertNoException).
  test("invalid arguments throw a catchable error", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { patchInternals } from "bun:internal-for-testing";
         try { patchInternals.apply("@@"); console.log("no-error"); } catch (e) { console.log("invalid-patchfile: " + e.message); }
         try { patchInternals.apply("@@", "bun-patch-test-nonexistent-dir"); console.log("no-error"); } catch (e) { console.log("bad-dir: " + e.code); }
         try { patchInternals.apply({ toString() { throw new Error("coerce-fail"); } }, process.cwd()); console.log("no-error"); } catch (e) { console.log("bad-patchfile-arg: " + e.message); }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n")).toEqual([
      "invalid-patchfile: bad_header_line failed to parse patchfile",
      "bad-dir: ENOENT",
      "bad-patchfile-arg: coerce-fail",
    ]);
    expect(exitCode).toBe(0);
  });

  // A crafted patch from an untrusted source must never panic the process. Both
  // cases below used to crash `bun install` when applying patchedDependencies.
  describe.concurrent("malformed patches do not crash", () => {
    test("file creation hunk with empty parts creates an empty file", async () => {
      await using dir = tempDir("patch-empty-parts", { ".keep": "" });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { patchInternals } from "bun:internal-for-testing";
           import { readFileSync } from "node:fs";
           const patch = [
             "diff --git a/newfile.txt b/newfile.txt",
             "new file mode 100644",
             "--- /dev/null",
             "+++ b/newfile.txt",
             "@@ -0,0 +0,0 @@",
             "",
           ].join("\\n");
           try {
             const ok = patchInternals.apply(patch, ${JSON.stringify(dir)});
             console.log("ok=" + ok + " contents=" + JSON.stringify(readFileSync(${JSON.stringify(dir)} + "/newfile.txt", "utf8")));
           } catch (e) {
             console.log("threw: " + e.code + " " + e.message);
           }`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: 'ok=true contents=""',
        stderr: "",
        exitCode: 0,
      });
    });

    test("header deleting more lines than the target file has does not apply", async () => {
      await using dir = tempDir("patch-underflow", { "target.txt": "only line\n" });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { patchInternals } from "bun:internal-for-testing";
           const body = [" only line"];
           for (let i = 0; i < 9; i++) body.push("-deleted " + i);
           const patch = [
             "diff --git a/target.txt b/target.txt",
             "--- a/target.txt",
             "+++ b/target.txt",
             "@@ -1,10 +1,1 @@",
             ...body,
             "",
           ].join("\\n");
           try {
             patchInternals.apply(patch, ${JSON.stringify(dir)});
             console.log("no-error");
           } catch (e) {
             console.log("caught: " + e.message);
           }`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: "caught: hunk #1 does not apply to target.txt (expected at line 1)",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  describe("stays inside the patch dir", () => {
    const files = {
      "pkg/real.txt": "SAFE\n",
      "pkg/sub/.keep": "",
      "outside/target.txt": "SAFE\n",
      "outside.txt": "SAFE\n",
    };
    const creation = (p: string) =>
      `diff --git a/${p} b/${p}\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,1 @@\n+PWNED\n`;
    const edit = (p: string) =>
      `diff --git a/${p} b/${p}\nindex 0000000..1111111 100644\n--- a/${p}\n+++ b/${p}\n@@ -1,1 +1,1 @@\n-SAFE\n+PWNED\n`;
    const deletion = (p: string) => `diff --git a/${p} b/${p}\ndeleted file mode 100644\nindex e69de29..0000000\n`;
    const rename = (from: string, to: string) =>
      `diff --git a/${from} b/${to}\nsimilarity index 100%\nrename from ${from}\nrename to ${to}\n`;
    const chmod = (p: string) => `diff --git a/${p} b/${p}\nold mode 100644\nnew mode 100755\n`;

    async function outsideState(root: string) {
      return {
        "outside.txt": await fs.readFile(join(root, "outside.txt"), "utf8"),
        "mode of outside.txt": (await fs.stat(join(root, "outside.txt"))).mode,
        "outside/": (await fs.readdir(join(root, "outside"))).sort(),
        "outside/target.txt": await fs.readFile(join(root, "outside", "target.txt"), "utf8"),
        "root": (await fs.readdir(root)).sort(),
      };
    }

    /** Applies `patch` to pkg/ and expects it to be refused with nothing outside pkg/ changed. */
    async function expectRefused(root: string, patch: string, code: string, path: string) {
      const before = await outsideState(root);
      let err: NodeJS.ErrnoException | undefined;
      try {
        apply(patch, join(root, "pkg"));
      } catch (e) {
        err = e as NodeJS.ErrnoException;
      }
      expect({ code: err?.code, path: err?.path, outside: await outsideState(root) }).toEqual({
        code,
        path,
        outside: before,
      });
    }

    const stillApplies: [string, string, string][] = [
      ["an edit of a regular file", edit("real.txt"), "real.txt"],
      ["an edit with a ./ prefix", edit("./real.txt"), "real.txt"],
      ["a new file in an existing directory", creation("sub/new.txt"), "sub/new.txt"],
      ["a new file in a directory the patch creates", creation("newdir/new.txt"), "newdir/new.txt"],
    ];

    describe.if(process.platform !== "win32")("symlinks", () => {
      async function link(root: string) {
        await fs.symlink(join(root, "outside.txt"), join(root, "pkg", "link"));
        await fs.symlink(join(root, "outside"), join(root, "pkg", "evildir"));
      }

      test.each([
        ["file creation through a symlink", creation("link"), "link"],
        ["file patch through a symlink", edit("link"), "link"],
        ["mode change through a symlink", chmod("link"), "link"],
        ["file creation over a file behind a directory symlink", creation("evildir/target.txt"), "evildir/target.txt"],
        ["file creation behind a directory symlink", creation("evildir/newfile.txt"), "evildir/newfile.txt"],
        ["file patch behind a directory symlink", edit("evildir/target.txt"), "evildir/target.txt"],
        ["file deletion behind a directory symlink", deletion("evildir/target.txt"), "evildir/target.txt"],
        [
          "file rename into a directory symlink",
          creation("payload.txt") + rename("payload.txt", "evildir/pwned.txt"),
          "evildir/pwned.txt",
        ],
        ["file rename out of a directory symlink", rename("evildir/target.txt", "stolen.txt"), "evildir/target.txt"],
      ])("%s is rejected", async (_name, patch, path) => {
        using dir = tempDir("patch-symlink", files);
        await link(String(dir));
        await expectRefused(String(dir), patch, "ELOOP", path);
      });

      test.each(stillApplies)("%s still applies", async (_name, patch, path) => {
        using dir = tempDir("patch-symlink", files);
        await link(String(dir));
        await apply(patch, join(String(dir), "pkg"));
        expect(await fs.readFile(join(String(dir), "pkg", path), "utf8")).toBe("PWNED\n");
      });
    });

    // `link.txt` and an outside path name the same inode, so truncating or writing through
    // the name inside the patch dir changes the outside file. NTFS hard links need no privilege.
    describe("hard links", () => {
      test.each([
        ["file patch of a hard-linked file", edit("link.txt")],
        ["file creation over a hard-linked file", creation("link.txt")],
        ["mode change of a hard-linked file", chmod("link.txt")],
      ])("%s is rejected", async (_name, patch) => {
        using dir = tempDir("patch-hardlink", files);
        await fs.link(join(String(dir), "outside.txt"), join(String(dir), "pkg", "link.txt"));
        await expectRefused(String(dir), patch, "EMLINK", "link.txt");
      });

      test("a regular file next to a hard link is still patched", async () => {
        using dir = tempDir("patch-hardlink", files);
        await fs.link(join(String(dir), "outside.txt"), join(String(dir), "pkg", "link.txt"));
        await apply(edit("real.txt"), join(String(dir), "pkg"));
        expect(await fs.readFile(join(String(dir), "pkg", "real.txt"), "utf8")).toBe("PWNED\n");
      });
    });

    // On Windows `O_NOFOLLOW` opens a reparse point itself instead of failing and
    // fstat on that handle reports a plain file, so containment there is an
    // attribute check on every component. Junctions need no privilege to create.
    describe.if(process.platform === "win32")("junctions", () => {
      const link = (root: string) => fs.symlink(join(root, "outside"), join(root, "pkg", "evildir"), "junction");

      test.each([
        ["file creation behind a junction", creation("evildir/newfile.txt"), "evildir/newfile.txt"],
        ["file patch behind a junction", edit("evildir/target.txt"), "evildir/target.txt"],
        ["file deletion behind a junction", deletion("evildir/target.txt"), "evildir/target.txt"],
        ["mode change of a junction itself", chmod("evildir"), "evildir"],
      ])("%s is rejected", async (_name, patch, path) => {
        using dir = tempDir("patch-junction", files);
        await link(String(dir));
        await expectRefused(String(dir), patch, "ELOOP", path);
      });

      test.each(stillApplies)("%s still applies", async (_name, patch, path) => {
        using dir = tempDir("patch-junction", files);
        await link(String(dir));
        await apply(patch, join(String(dir), "pkg"));
        expect(await fs.readFile(join(String(dir), "pkg", path), "utf8")).toBe("PWNED\n");
      });

      test("a mode change of a regular file still applies", async () => {
        using dir = tempDir("patch-junction", files);
        await link(String(dir));
        await apply(chmod("real.txt"), join(String(dir), "pkg"));
        expect(await fs.readFile(join(String(dir), "pkg", "real.txt"), "utf8")).toBe("SAFE\n");
      });

      // `Z:..` is not byte-equal to `..`, but the openat normalizer strips the `Z:` prefix
      // from a relative component and then resolves a real `..`.
      test("a drive-relative `Z:..` component is rejected", async () => {
        using dir = tempDir("patch-drive-rel", files);
        await expectRefused(String(dir), creation("Z:../escaped.txt"), "EINVAL", "Z:../escaped.txt");
      });
    });

    // A `..` component with a trailing NUL byte is not byte-equal to `..`, but the
    // kernel reads each component as a NUL-terminated C string and resolves a real
    // `..`. Run in a child process: the unfixed failure mode is a process abort.
    test("a `..` component hidden behind a NUL is rejected", async () => {
      using dir = tempDir("patch-nul", {
        "outside/.keep": "",
        "pkg/a/b/.keep": "",
      });

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { patchInternals } from "bun:internal-for-testing";
           const NUL = String.fromCharCode(0);
           const P = ".." + NUL + "1/.." + NUL + "2/.." + NUL + "3/outside/escaped.txt";
           const patch = [
             "diff --git a/" + P + " b/" + P,
             "new file mode 100644",
             "--- /dev/null",
             "+++ b/" + P,
             "@@ -0,0 +1,1 @@",
             "+PWNED",
             "",
           ].join("\\n");
           try {
             patchInternals.apply(patch, ${JSON.stringify(join(String(dir), "pkg", "a", "b"))});
             console.log("no-error");
           } catch (e) {
             console.log("caught: " + e.code);
           }`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({
        stdout: stdout.trim(),
        stderr,
        outside: await fs.readdir(join(String(dir), "outside")),
        exitCode,
      }).toEqual({ stdout: "caught: EINVAL", stderr: "", outside: [".keep"], exitCode: 0 });
    });

    // `O_RDONLY` on a FIFO without `O_NONBLOCK` blocks until a writer appears, so
    // the target open must use `O_NONBLOCK` for the `!ISREG` check to ever run.
    // Run in a child process: the unfixed failure mode is an indefinite hang.
    test.if(process.platform !== "win32")("a mode change of a FIFO is rejected instead of hanging", async () => {
      using dir = tempDir("patch-fifo", { "pkg/.keep": "" });
      const pkgDir = join(String(dir), "pkg");
      await $`mkfifo ${join(pkgDir, "pipe")}`;

      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { patchInternals } from "bun:internal-for-testing";
           const patch = "diff --git a/pipe b/pipe\\nold mode 100644\\nnew mode 100755\\n";
           try {
             patchInternals.apply(patch, ${JSON.stringify(pkgDir)});
             console.log("no-error");
           } catch (e) {
             console.log("caught: " + e.code);
           }`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
        stdout: "caught: EINVAL",
        stderr: "",
        exitCode: 0,
      });
    });
  });
});

describe("makeDiff", () => {
  // git names one folder on both sides of the headers of an added file (the new one) and of a
  // deleted file (the old one). A name that is not ASCII is printed as it is.
  test("strips both folders from both sides of every header", async () => {
    await using tempdir = tempDir("patch-make-diff", {
      "a/changed.txt": "one\n",
      "a/deleted.txt": "bye\n",
      "a/é.txt": "one\n",
      "b/changed.txt": "two\n",
      "b/added.txt": "hi\n",
      "b/é.txt": "two\n",
      "b/ü.txt": "new\n",
    });
    const afolder = join(String(tempdir), "a");
    const bfolder = join(String(tempdir), "b");

    const patch = await makeDiff(afolder, bfolder, String(tempdir));
    expect(patch.match(/^(diff --git|---|\+\+\+) .*$/gm)).toEqual([
      "diff --git a/added.txt b/added.txt",
      "--- /dev/null",
      "+++ b/added.txt",
      "diff --git a/changed.txt b/changed.txt",
      "--- a/changed.txt",
      "+++ b/changed.txt",
      "diff --git a/deleted.txt b/deleted.txt",
      "diff --git a/é.txt b/é.txt",
      "--- a/é.txt",
      "+++ b/é.txt",
      "diff --git a/ü.txt b/ü.txt",
      "--- /dev/null",
      "+++ b/ü.txt",
    ]);
    expect(patch).toBe(await makeDiffJs(afolder, bfolder, String(tempdir)));
  });

  // The old folder is a git checkout in the cache, the new one a copy of it that left the links out.
  test.skipIf(process.platform === "win32")("leaves out the symlinks that only the old folder has", async () => {
    await using tempdir = tempDir("patch-make-diff-links", {
      "a/a.txt": "one\n",
      "a/m.txt": "one\n",
      "a/z.txt": "one\n",
      "b/a.txt": "one\n",
      "b/m.txt": "two\n",
      "b/replaced": "now a file\n",
      "b/z.txt": "one\n",
    });
    for (const link of ["a-first", "n-middle", "replaced", "zz-last"]) {
      await fs.symlink("m.txt", join(String(tempdir), "a", link));
    }

    const patch = await makeDiff(join(String(tempdir), "a"), join(String(tempdir), "b"), String(tempdir));
    expect(patch.match(/^(diff --git|deleted file|new file|index|---|\+\+\+) .*$/gm)).toEqual([
      "diff --git a/m.txt b/m.txt",
      expect.stringMatching(/^index \w+\.\.\w+ 100644$/),
      "--- a/m.txt",
      "+++ b/m.txt",
      "diff --git a/replaced b/replaced",
      "new file mode 100644",
      expect.stringMatching(/^index 0+\.\.\w+$/),
      "--- /dev/null",
      "+++ b/replaced",
    ]);
    expect(patch).toEndWith("+now a file\n");

    await fs.rm(join(String(tempdir), "b", "replaced"));
    await fs.writeFile(join(String(tempdir), "b", "m.txt"), "one\n");
    expect(await makeDiff(join(String(tempdir), "a"), join(String(tempdir), "b"), String(tempdir))).toBe("");
  });
});

describe("parse", () => {
  test("works for a simple case", () => {
    expect(removeCapacity(JSON.parse(parse(patch)))).toEqual({
      "parts": {
        "items": [
          {
            "file_patch": {
              "path": "banana.ts",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 1, "len": 5 }, "patched": { "start": 1, "len": 5 } },
                    "parts": {
                      "items": [
                        {
                          "type": "context",
                          "lines": { "items": ["this", "is", ""] },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "deletion",
                          "lines": { "items": ["a"] },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": [""] },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["file"] },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                    },
                  },
                ],
              },
              "before_hash": "2de83dd",
              "after_hash": "842652c",
            },
          },
        ],
      },
    });
  });

  test("fails when the patch file has invalid headers", () => {
    expect(() => parse(invalidHeaders1)).toThrow();
    expect(() => parse(invalidHeaders2)).toThrow();
    expect(() => parse(invalidHeaders3)).toThrow();
    expect(() => parse(invalidHeaders4)).toThrow();
    expect(() => parse(invalidHeaders5)).toThrow();
  });

  test("is OK when blank lines are accidentally created", () => {
    expect(parse(accidentalBlankLine)).toEqual(parse(patch));
  });

  test(`can handle files with CRLF line breaks`, () => {
    expect(removeCapacity(JSON.parse(parse(crlfLineBreaks)))).toEqual({
      "parts": {
        "items": [
          {
            "file_creation": {
              "path": "banana.ts",
              "mode": "non_executable",
              "hunk": {
                "header": { "original": { "start": 0, "len": 0 }, "patched": { "start": 1, "len": 1 } },
                "parts": {
                  "items": [
                    {
                      "type": "insertion",
                      "lines": { "items": ["this is a new file\r"] },
                      "no_newline_at_end_of_file": false,
                    },
                  ],
                },
              },
              "hash": "3e1267f",
            },
          },
        ],
      },
    });
  });

  test("works", () => {
    expect(removeCapacity(JSON.parse(parse(modeChangeAndModifyAndRename)))).toEqual({
      "parts": {
        "items": [
          { "file_rename": { "from_path": "numbers.txt", "to_path": "banana.txt" } },
          { "file_mode_change": { "path": "banana.txt", "old_mode": "non_executable", "new_mode": "executable" } },
          {
            "file_patch": {
              "path": "banana.txt",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 1, "len": 4 }, "patched": { "start": 1, "len": 4 } },
                    "parts": {
                      "items": [
                        {
                          "type": "deletion",
                          "lines": { "items": ["one"] },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": ["ne"] },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["", "two", ""] },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                    },
                  },
                ],
              },
              "before_hash": "fbf1785",
              "after_hash": "92d2c5f",
            },
          },
        ],
      },
    });
  });

  test("parses old-style patches", () => {
    expect(removeCapacity(JSON.parse(parse(oldStylePatch)))).toEqual({
      "parts": {
        "items": [
          {
            "file_patch": {
              "path": "node_modules/graphql/utilities/assertValidName.js",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 41, "len": 10 }, "patched": { "start": 41, "len": 11 } },
                    "parts": {
                      "items": [
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              " */",
                              "function isValidNameError(name, node) {",
                              "  !(typeof name === 'string') ? (0, _invariant2.default)(0, 'Expected string') : void 0;",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "deletion",
                          "lines": {
                            "items": [
                              "  if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "    return new _GraphQLError.GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  }",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": {
                            "items": [
                              "  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "  //   return new _GraphQLError.GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  // }",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              "  if (!NAME_RX.test(name)) {",
                              "    return new _GraphQLError.GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but \"' + name + '\" does not.', node);",
                              "  }",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": [""] },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["}"] },
                          "no_newline_at_end_of_file": true,
                        },
                      ],
                    },
                  },
                ],
              },
              "before_hash": null,
              "after_hash": null,
            },
          },
          {
            "file_patch": {
              "path": "node_modules/graphql/utilities/assertValidName.mjs",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 29, "len": 9 }, "patched": { "start": 29, "len": 9 } },
                    "parts": {
                      "items": [
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              " */",
                              "export function isValidNameError(name, node) {",
                              "  !(typeof name === 'string') ? invariant(0, 'Expected string') : void 0;",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "deletion",
                          "lines": {
                            "items": [
                              "  if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "    return new GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  }",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": {
                            "items": [
                              "  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {",
                              "  //   return new GraphQLError('Name \"' + name + '\" must not begin with \"__\", which is reserved by ' + 'GraphQL introspection.', node);",
                              "  // }",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": {
                            "items": [
                              "  if (!NAME_RX.test(name)) {",
                              "    return new GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but \"' + name + '\" does not.', node);",
                              "  }",
                            ],
                          },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                    },
                  },
                ],
              },
              "before_hash": null,
              "after_hash": null,
            },
          },
        ],
      },
    });
  });

  // A legacy patch that both deletes a line whose content begins with "-- a/" and uses
  // "--- a/<path>" as the next-file separator. The parser must distinguish the two by hunk
  // line counts instead of retrying the whole file in a second legacy-mode pass.
  test("parses old-style patches whose hunks delete lines beginning with '-- a/'", () => {
    const patch =
      "--- a/first.txt\n" +
      "+++ b/first.txt\n" +
      "@@ -1,2 +1,1 @@\n" +
      "--- a/foo\n" +
      " bar\n" +
      "--- a/second.txt\n" +
      "+++ b/second.txt\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-x\n" +
      "+y\n";

    const part = (type: string, line: string) => ({
      "type": type,
      "lines": { "items": [line] },
      "no_newline_at_end_of_file": false,
    });
    const filePatch = (path: string, originalLen: number, parts: object[]) => ({
      "file_patch": {
        "path": path,
        "hunks": {
          "items": [
            {
              "header": { "original": { "start": 1, "len": originalLen }, "patched": { "start": 1, "len": 1 } },
              "parts": { "items": parts },
            },
          ],
        },
        "before_hash": null,
        "after_hash": null,
      },
    });
    expect(removeCapacity(JSON.parse(parse(patch)))).toEqual({
      "parts": {
        "items": [
          filePatch("first.txt", 2, [part("deletion", "-- a/foo"), part("context", "bar")]),
          filePatch("second.txt", 1, [part("deletion", "x"), part("insertion", "y")]),
        ],
      },
    });
  });

  // After stripping the "index " prefix the remainder can itself start with "index ",
  // which used to trip a bogus debug assertion in parse_diff_hashes.
  test("does not crash when an index line repeats the 'index ' prefix", () => {
    for (const line of ["index index ", "index index \n", "index index 2de83dd..842652c 100644\n"]) {
      expect(removeCapacity(JSON.parse(parse(line)))).toEqual({ parts: { items: [] } });
    }
  });

  // A `---`/`+++` header line can be shorter than "--- a/"/"+++ b/" (no path after the marker).
  // This used to crash the parser with an out-of-bounds slice.
  test("does not crash on truncated ---/+++ header lines", () => {
    for (const truncated of ["+++ ", "--- ", "--- a", "+++ b"]) {
      expect(removeCapacity(JSON.parse(parse(truncated)))).toEqual({ "parts": { "items": [] } });
    }

    // a truncated header line falls back to the paths from the `diff --git` line
    const truncatedHeaderPatch = `diff --git a/banana.ts b/banana.ts\n--- \n+++ \n@@ -1,1 +1,1 @@\n-a\n+b\n`;
    expect(removeCapacity(JSON.parse(parse(truncatedHeaderPatch)))).toEqual({
      "parts": {
        "items": [
          {
            "file_patch": {
              "path": "banana.ts",
              "hunks": {
                "items": [
                  {
                    "header": { "original": { "start": 1, "len": 1 }, "patched": { "start": 1, "len": 1 } },
                    "parts": {
                      "items": [
                        {
                          "type": "deletion",
                          "lines": { "items": ["a"] },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": ["b"] },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                    },
                  },
                ],
              },
              "before_hash": null,
              "after_hash": null,
            },
          },
        ],
      },
    });
  });

  // No tool that makes patches for packages writes these, and the change in them would be lost.
  test.each([
    ["a hunk of no file", "@@ -1 +1 @@\n-a\n+b\n", "no_path_given_for_hunk"],
    [
      "a binary patch",
      "diff --git a/a.bin b/a.bin\nindex 2de83dd..842652c 100644\nGIT binary patch\nliteral 3\nKcmZQzWC8#H2LJ>B\n\nliteral 3\nKcmZQzWCj2L2ml2D\n\n",
      "git_binary_patch_not_supported",
    ],
    [
      "a binary patch of a new file",
      "diff --git a/a.bin b/a.bin\nnew file mode 100644\nindex 0000000..842652c\nGIT binary patch\nliteral 3\nKcmZQzWC8#H2LJ>B\n\nliteral 0\nHcmV?d00001\n\n",
      "git_binary_patch_not_supported",
    ],
  ])("refuses %s", (_name, patchfile, error) => {
    expect(() => parse(patchfile)).toThrow(error);
  });

  // Patch files that older versions wrote have these. The install warns about them.
  test.each([
    ["a copy", "diff --git a/lib.js b/lib-copy.js\nsimilarity index 100%\ncopy from lib.js\ncopy to lib-copy.js\n", []],
    ["colored output", "\x1b[1mdiff --git a/a.js b/a.js\x1b[m\n\x1b[36m@@ -1 +1 @@\x1b[m\n\x1b[31m-a\x1b[m\n", []],
    ["a header alone", "diff --git a/a.js b/a.js\nindex 2de83dd..842652c 100644\n", []],
    [
      "text after the last hunk",
      "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\nOnly in b: new.js\n",
      ["file_patch"],
    ],
    [
      "a changed binary file",
      "diff --git a/a.bin b/a.bin\nindex 2de83dd..842652c 100644\nBinary files a/a.bin and b/a.bin differ\n",
      [],
    ],
    [
      "a renamed and changed binary file",
      "diff --git a/a.bin b/b.bin\nsimilarity index 90%\nrename from a.bin\nrename to b.bin\nindex 2de83dd..842652c 100644\nBinary files a/a.bin and b/b.bin differ\n",
      ["file_rename"],
    ],
  ])("leaves out %s", (_name, patchfile, parts) => {
    expect(JSON.parse(parse(patchfile)).parts.items.flatMap(Object.keys)).toEqual(parts);
  });

  test("a deleted binary file is a deletion", () => {
    expect(
      removeCapacity(
        JSON.parse(
          parse(
            "diff --git a/a.bin b/a.bin\ndeleted file mode 100644\nindex 2de83dd..0000000\nBinary files a/a.bin and /dev/null differ\n",
          ),
        ),
      ),
    ).toEqual({
      parts: { items: [{ file_deletion: { path: "a.bin", mode: "non_executable", hunk: null, hash: "2de83dd" } }] },
    });
  });
});

const patch = `diff --git a/banana.ts b/banana.ts\nindex 2de83dd..842652c 100644\n--- a/banana.ts\n+++ b/banana.ts\n@@ -1,5 +1,5 @@\n this\n is\n \n-a\n+\n file\n`;

const invalidHeaders1 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,4 @@
 this
 is

-a
+
 file
`;

const invalidHeaders2 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,4 +1,5 @@
 this
 is

-a
+
 file
`;

const invalidHeaders3 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,0 +1,5 @@
 this
 is

-a
+
 file
`;
const invalidHeaders4 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,0 @@
 this
 is

-a
+
 file
`;

const invalidHeaders5 = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,5@@
 this
 is

-a
+
 file
`;

const accidentalBlankLine = /* diff */ `diff --git a/banana.ts b/banana.ts
index 2de83dd..842652c 100644
--- a/banana.ts
+++ b/banana.ts
@@ -1,5 +1,5 @@
 this
 is

-a
+
 file
`;

const crlfLineBreaks = /* diff */ `diff --git a/banana.ts b/banana.ts
new file mode 100644
index 0000000..3e1267f
--- /dev/null
+++ b/banana.ts
@@ -0,0 +1 @@
+this is a new file
`.replace(/\n/g, "\r\n");

const modeChangeAndModifyAndRename = /* diff */ `diff --git a/numbers.txt b/banana.txt
old mode 100644
new mode 100755
similarity index 96%
rename from numbers.txt
rename to banana.txt
index fbf1785..92d2c5f
--- a/numbers.txt
+++ b/banana.txt
@@ -1,4 +1,4 @@
-one
+ne

 two

`;

const oldStylePatch = /* diff */ `patch-package
--- a/node_modules/graphql/utilities/assertValidName.js
+++ b/node_modules/graphql/utilities/assertValidName.js
@@ -41,10 +41,11 @@ function assertValidName(name) {
  */
 function isValidNameError(name, node) {
   !(typeof name === 'string') ? (0, _invariant2.default)(0, 'Expected string') : void 0;
-  if (name.length > 1 && name[0] === '_' && name[1] === '_') {
-    return new _GraphQLError.GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
-  }
+  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {
+  //   return new _GraphQLError.GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
+  // }
   if (!NAME_RX.test(name)) {
     return new _GraphQLError.GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but "' + name + '" does not.', node);
   }
+
 }
\\ No newline at end of file
--- a/node_modules/graphql/utilities/assertValidName.mjs
+++ b/node_modules/graphql/utilities/assertValidName.mjs
@@ -29,9 +29,9 @@ export function assertValidName(name) {
  */
 export function isValidNameError(name, node) {
   !(typeof name === 'string') ? invariant(0, 'Expected string') : void 0;
-  if (name.length > 1 && name[0] === '_' && name[1] === '_') {
-    return new GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
-  }
+  // if (name.length > 1 && name[0] === '_' && name[1] === '_') {
+  //   return new GraphQLError('Name "' + name + '" must not begin with "__", which is reserved by ' + 'GraphQL introspection.', node);
+  // }
   if (!NAME_RX.test(name)) {
     return new GraphQLError('Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but "' + name + '" does not.', node);
   }
`;
function escapeStringRegexp(string: string) {
  if (typeof string !== "string") {
    throw new TypeError("Expected a string");
  }

  // Escape characters with special meaning either inside or outside character sets.
  // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
  return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

function removeTrailingAndLeadingSlash(p: string): string {
  if (p[0] === "/" || p.endsWith("/")) {
    return p.replace(/^\/|\/$/g, "");
  }
  return p;
}
