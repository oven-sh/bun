import { $ } from "bun";
import { describe, test, expect, it } from "bun:test";
import { patchInternals } from "bun:internal-for-testing";
import { tempDirWithFiles as __tempDirWithFiles } from "harness";
import { join as __join } from "node:path";
import fs from "fs/promises";
const { parse, apply, makeDiff } = patchInternals;

const makeDiffJs = async (aFolder: string, bFolder: string, cwd: string): Promise<string> => {
  const { stdout, stderr } =
    await $`git -c core.safecrlf=false diff --src-prefix=a/ --dst-prefix=b/ --ignore-cr-at-eol --irreversible-delete --full-index --no-index ${aFolder} ${bFolder}`
      .env(
        // https://github.com/pnpm/pnpm/blob/45f4262f0369cadf41cea3b823e8932eae157c4b/patching/plugin-commands-patching/src/patchCommit.ts#L117
        {
          ...process.env,
          // #region Predictable output
          // These variables aim to ignore the global git config so we get predictable output
          // https://git-scm.com/docs/git#Documentation/git.txt-codeGITCONFIGNOSYSTEMcode
          GIT_CONFIG_NOSYSTEM: "1",
          HOME: "",
          XDG_CONFIG_HOME: "",
          USERPROFILE: "",
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

describe("apply", () => {
  test("edgecase", async () => {
    const newcontents = "module.exports = x => x % 420 === 0;";
    const tempdir2 = tempDirWithFiles("patch-test2", {
      ".bun/install/cache/is-even@1.0.0": {
        "index.js": "module.exports = x => x % 2 === 0;",
      },
    });
    const tempdir = tempDirWithFiles("patch-test", {
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

    await apply(patchfile, `${tempdir}/node_modules/is-even`);
    expect(await fs.readFile(`${tempdir}/node_modules/is-even/index.js`).then(b => b.toString())).toBe(newcontents);
  });

  test("empty", async () => {
    const tempdir = tempDirWithFiles("patch-test", {
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
      const tempdir = tempDirWithFiles("patch-test", files);

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
      const tempdir = tempDirWithFiles("patch-test", files);

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
      const tempdir = tempDirWithFiles("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "newfile.txt")}`.cwd(tempdir).text()).toBe(files["b/newfile.txt"]);
    });
  });

  describe("rename", () => {
    test("files", async () => {
      const files = {
        "a/hey.txt": "hello!",
        "b/heynow.txt": "hello!",
      };
      const tempdir = tempDirWithFiles("patch-test", files);

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "heynow.txt")}`.cwd(tempdir).text()).toBe(files["b/heynow.txt"]);
      expect(
        await $`if ls -d ${join(afolder, "hey.txt")}; then echo oops; else echo okay!; fi;`.cwd(tempdir).text(),
      ).toBe("okay!\n");
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
      const tempdir = tempDirWithFiles("patch-test", files);

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

      const tempdir = tempDirWithFiles("patch-test", files);

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

  describe("patch", () => {
    test("simple insertion", async () => {
      const afile = `hello!\n`;
      const bfile = `hello!\nwassup?\n`;

      const tempdir = tempDirWithFiles("patch-test", {
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

      const tempdir = tempDirWithFiles("patch-test", {
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

      const tempdir = tempDirWithFiles("patch-test", {
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

      const tempdir = tempDirWithFiles("patch-test", {
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

      const tempdir = tempDirWithFiles("patch-test", {
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

      const tempdir = tempDirWithFiles("patch-test", {
        "a/hello.txt": afile,
        "b/hello.txt": bfile,
      });

      const afolder = join(tempdir, "a");
      const bfolder = join(tempdir, "b");

      const patchfile = await makeDiff(afolder, bfolder, tempdir);

      await apply(patchfile, afolder);

      expect(await $`cat ${join(afolder, "hello.txt")}`.cwd(tempdir).text()).toBe(bfile);
    });
  });

  describe("No newline at end of file", () => {
    // TODO: simple, multiline, multiple hunks
  });
});

describe("parse", () => {
  test("works for a simple case", () => {
    expect(JSON.parse(parse(patch))).toEqual({
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
                          "lines": { "items": ["this", "is", ""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "deletion",
                          "lines": { "items": ["a"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": [""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["file"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
              },
              "before_hash": "2de83dd",
              "after_hash": "842652c",
            },
          },
        ],
        "capacity": 8,
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
    expect(JSON.parse(parse(crlfLineBreaks))).toEqual({
      "parts": {
        "items": [
          {
            "file_creation": {
              "path": "banana.ts",
              "mode": "non_executable",
              "hunk": {
                "header": { "original": { "start": 1, "len": 0 }, "patched": { "start": 1, "len": 1 } },
                "parts": {
                  "items": [
                    {
                      "type": "insertion",
                      "lines": { "items": ["this is a new file\r"], "capacity": 8 },
                      "no_newline_at_end_of_file": false,
                    },
                  ],
                  "capacity": 8,
                },
              },
              "hash": "3e1267f",
            },
          },
        ],
        "capacity": 8,
      },
    });
  });

  test("works", () => {
    expect(JSON.parse(parse(modeChangeAndModifyAndRename))).toEqual({
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
                          "lines": { "items": ["one"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": ["ne"], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["", "two", ""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
              },
              "before_hash": "fbf1785",
              "after_hash": "92d2c5f",
            },
          },
        ],
        "capacity": 8,
      },
    });
  });

  test("parses old-style patches", () => {
    expect(JSON.parse(parse(oldStylePatch))).toEqual({
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
                            "capacity": 8,
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
                            "capacity": 8,
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
                            "capacity": 8,
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
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "insertion",
                          "lines": { "items": [""], "capacity": 8 },
                          "no_newline_at_end_of_file": false,
                        },
                        {
                          "type": "context",
                          "lines": { "items": ["}"], "capacity": 8 },
                          "no_newline_at_end_of_file": true,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
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
                            "capacity": 8,
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
                            "capacity": 8,
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
                            "capacity": 8,
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
                            "capacity": 8,
                          },
                          "no_newline_at_end_of_file": false,
                        },
                      ],
                      "capacity": 8,
                    },
                  },
                ],
                "capacity": 8,
              },
              "before_hash": null,
              "after_hash": null,
            },
          },
        ],
        "capacity": 8,
      },
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
