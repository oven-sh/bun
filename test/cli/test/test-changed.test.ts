import { spawnSync } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  forEachLine,
  isASAN,
  isLinux,
  isWindows,
  tempDir,
  tmpdirSync,
  untilEveryThreadIs,
} from "harness";
import { appendFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// Each case spawns a full `bun test` process; give the concurrent group
// headroom on slow ASAN/CI machines.
setDefaultTimeout(isASAN ? 120_000 : 30_000);

// Keep git from reading the developer's global config and make commits
// deterministic across machines. Used both for the `git` helper below and
// for every spawned `bun test --changed` process, since that process
// itself shells out to git and would otherwise inherit the developer's
// excludes/config.
//
// GIT_CONFIG_GLOBAL must point at a real (empty) file: pointing at the
// null device works on most platforms, but git on some Windows builds
// rejects "NUL" with "unable to access 'NUL': Invalid argument".
const emptyGitConfig = join(tmpdirSync(), "empty.gitconfig");
writeFileSync(emptyGitConfig, "");
const gitEnv = {
  ...bunEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: emptyGitConfig,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]) {
  const res = spawnSync({ cmd: ["git", ...args], cwd, env: gitEnv, stdout: "pipe", stderr: "pipe" });
  if (!res.success) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${res.stderr.toString()}`);
  }
  return res.stdout.toString();
}

function initRepo(cwd: string) {
  git(cwd, "init", "-q");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "initial");
}

async function runTestChanged(
  cwd: string,
  extra: string[] = [],
  changed = "--changed",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", changed, ...extra],
    cwd,
    env: gitEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** Which of the given test-file basenames were executed (appear as a file
 *  header in bun test's stderr). */
function ranFiles(stderr: string, names: string[]): string[] {
  return names.filter(n => stderr.includes(n + ":")).sort();
}

// The --watch test at the end is the slow one; everything else is independent
// git repos so run them concurrently.
describe.concurrent("bun test --changed", () => {
  const fixture = {
    "package.json": JSON.stringify({ name: "changed-test", type: "module" }),
    // a.test.ts -> util.ts -> helper.ts (transitive, two levels)
    "src/helper.ts": `export const helper = () => 1;\n`,
    "src/util.ts": `import { helper } from "./helper";\nexport const util = () => helper() + 1;\n`,
    "a.test.ts": `import { test, expect } from "bun:test";\nimport { util } from "./src/util";\ntest("a", () => expect(util()).toBe(2));\n`,
    // b.test.ts -> other.ts (independent subgraph)
    "src/other.ts": `export const other = () => 9;\n`,
    "b.test.ts": `import { test, expect } from "bun:test";\nimport { other } from "./src/other";\ntest("b", () => expect(other()).toBe(9));\n`,
    // c.test.ts has no local imports
    "c.test.ts": `import { test, expect } from "bun:test";\ntest("c", () => expect(1).toBe(1));\n`,
    // non-source file that nothing imports
    "README.md": "hello\n",
  };
  const names = ["a.test.ts", "b.test.ts", "c.test.ts"];

  test("no changes -> runs nothing and exits 0", async () => {
    using dir = tempDir("test-changed-none", fixture);
    initRepo(String(dir));

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual([]);
    expect(stderr).toContain("no changed files");
    expect(exitCode).toBe(0);
  });

  test("direct change to a test file runs only that test", async () => {
    using dir = tempDir("test-changed-direct", fixture);
    initRepo(String(dir));

    appendFileSync(join(String(dir), "c.test.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual(["c.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("change to a direct dependency selects the importing test", async () => {
    using dir = tempDir("test-changed-dep", fixture);
    initRepo(String(dir));

    appendFileSync(join(String(dir), "src", "other.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual(["b.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("change to a transitive dependency selects the importing test", async () => {
    using dir = tempDir("test-changed-transitive", fixture);
    initRepo(String(dir));

    // a.test.ts -> util.ts -> helper.ts: touching helper should select a.
    appendFileSync(join(String(dir), "src", "helper.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual(["a.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("change to a file no test imports runs nothing", async () => {
    using dir = tempDir("test-changed-unrelated", fixture);
    initRepo(String(dir));

    appendFileSync(join(String(dir), "README.md"), "more\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual([]);
    expect(stderr).toContain("1 changed file, but no test files are affected");
    expect(stderr).toContain("the static imports of 3 test files do not reach README.md\n");
    expect(exitCode).toBe(0);
  });

  test("changed files that select nothing are not named beside a run of test files", async () => {
    using dir = tempDir("test-changed-some-unreached", fixture);
    initRepo(String(dir));

    appendFileSync(join(String(dir), "src", "other.ts"), "// touched\n");
    appendFileSync(join(String(dir), "README.md"), "more\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual(["b.test.ts"]);
    expect(stderr).toContain("2 changed files, running 1/3 test files\n");
    expect(stderr).not.toContain("README.md");
    expect(exitCode).toBe(0);
  });

  test("more than five changed files that select nothing are named in part", async () => {
    using dir = tempDir("test-changed-many-unreached", fixture);
    initRepo(String(dir));

    for (let i = 0; i < 7; i++) writeFileSync(join(String(dir), `note-${i}.md`), "note\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual([]);
    expect(stderr).toContain("7 changed files, but no test files are affected");
    expect(stderr).toMatch(
      /the static imports of 3 test files do not reach (note-\d\.md, ){4}note-\d\.md and 2 more\n/,
    );
    expect(exitCode).toBe(0);
  });

  describe("a deleted or renamed import selects its importers", () => {
    const lib = `export const v = 1;\n`;
    const importing = (specifier: string) =>
      `import { test, expect } from "bun:test";\nimport { v } from "${specifier}";\ntest("uses", () => expect(v).toBe(1));\n`;
    const deletionFixture = {
      "package.json": JSON.stringify({ name: "deleted", type: "module" }),
      "lib.ts": lib,
      "unused.ts": lib,
      "uses.test.ts": importing("./lib"),
      "other.test.ts": `import { test, expect } from "bun:test";\ntest("other", () => expect(1).toBe(1));\n`,
    };
    const deletionNames = ["uses.test.ts", "other.test.ts"];

    test("git rm", async () => {
      using dir = tempDir("test-changed-git-rm", deletionFixture);
      initRepo(String(dir));
      git(String(dir), "rm", "-q", "lib.ts");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(stderr).toContain("1 changed file, running 1/2 test files\n");
      expect(exitCode).toBe(1);
    });

    test("rm without git", async () => {
      using dir = tempDir("test-changed-rm", deletionFixture);
      initRepo(String(dir));
      rmSync(join(String(dir), "lib.ts"));

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("a deletion committed since --changed=<ref>", async () => {
      using dir = tempDir("test-changed-rm-ref", deletionFixture);
      initRepo(String(dir));
      git(String(dir), "rm", "-q", "lib.ts");
      git(String(dir), "commit", "-q", "-m", "remove lib");

      const { stderr, exitCode } = await runTestChanged(String(dir), [], "--changed=HEAD~1");
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("git mv with the importer left as it was", async () => {
      using dir = tempDir("test-changed-git-mv", deletionFixture);
      initRepo(String(dir));
      git(String(dir), "mv", "lib.ts", "renamed.ts");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("git mv with the importer updated selects only that importer", async () => {
      using dir = tempDir("test-changed-git-mv-updated", deletionFixture);
      initRepo(String(dir));
      git(String(dir), "mv", "lib.ts", "renamed.ts");
      writeFileSync(join(String(dir), "uses.test.ts"), importing("./renamed"));
      git(String(dir), "add", "-A");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(stderr).toContain("3 changed files, running 1/2 test files\n");
      expect(exitCode).toBe(0);
    });

    test("an import that names another extension", async () => {
      using dir = tempDir("test-changed-rm-js-extension", {
        ...deletionFixture,
        "uses.test.ts": importing("./lib.js"),
      });
      initRepo(String(dir));
      rmSync(join(String(dir), "lib.ts"));

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("the index file of an imported directory", async () => {
      using dir = tempDir("test-changed-rm-index", {
        ...deletionFixture,
        "pkg/index.ts": lib,
        "uses.test.ts": importing("./pkg"),
      });
      initRepo(String(dir));
      rmSync(join(String(dir), "pkg", "index.ts"));

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("the file that main of an imported directory's package.json names", async () => {
      using dir = tempDir("test-changed-rm-main", {
        ...deletionFixture,
        "pkg/package.json": JSON.stringify({ name: "pkg", main: "src/entry.ts" }),
        "pkg/src/entry.ts": lib,
        "pkg/src/other.ts": lib,
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@alias/*": ["./*"] } } }),
        "uses.test.ts": importing("./pkg"),
        "alias.test.ts": importing("@alias/pkg"),
      });
      initRepo(String(dir));
      const mainNames = [...deletionNames, "alias.test.ts"];

      rmSync(join(String(dir), "pkg", "src", "other.ts"));
      {
        const { stderr, exitCode } = await runTestChanged(String(dir));
        expect(ranFiles(stderr, mainNames)).toEqual([]);
        expect(exitCode).toBe(0);
      }
      rmSync(join(String(dir), "pkg", "src", "entry.ts"));
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, mainNames)).toEqual(["alias.test.ts", "uses.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("a transitive import", async () => {
      using dir = tempDir("test-changed-rm-transitive", {
        ...deletionFixture,
        "middle.ts": `export { v } from "./lib";\n`,
        "uses.test.ts": importing("./middle"),
      });
      initRepo(String(dir));
      rmSync(join(String(dir), "lib.ts"));

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("a deleted file that nothing imports selects nothing and is named", async () => {
      using dir = tempDir("test-changed-rm-unused", deletionFixture);
      initRepo(String(dir));
      rmSync(join(String(dir), "unused.ts"));

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, deletionNames)).toEqual([]);
      expect(stderr).toContain("1 changed file, but no test files are affected");
      expect(stderr).toContain("the static imports of 2 test files do not reach unused.ts\n");
      expect(exitCode).toBe(0);
    });

    test("a rename committed since --changed=<ref>", async () => {
      using dir = tempDir("test-changed-git-mv-ref", deletionFixture);
      initRepo(String(dir));
      git(String(dir), "mv", "lib.ts", "renamed.ts");
      git(String(dir), "commit", "-q", "-m", "rename lib");

      const { stderr, exitCode } = await runTestChanged(String(dir), [], "--changed=HEAD~1");
      expect(ranFiles(stderr, deletionNames)).toEqual(["uses.test.ts"]);
      expect(stderr).toContain("2 changed files, running 1/2 test files\n");
      expect(exitCode).toBe(1);
    });

    test("an import through a tsconfig paths alias", async () => {
      using dir = tempDir("test-changed-rm-alias", {
        ...deletionFixture,
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"], "exact": ["./lib.ts"] } } }),
        "src/aliased.ts": lib,
        "uses.test.ts": importing("@/aliased"),
        "exact.test.ts": importing("exact"),
      });
      initRepo(String(dir));
      const aliasNames = [...deletionNames, "exact.test.ts"];

      rmSync(join(String(dir), "src", "aliased.ts"));
      {
        const { stderr, exitCode } = await runTestChanged(String(dir));
        expect(ranFiles(stderr, aliasNames)).toEqual(["uses.test.ts"]);
        expect(exitCode).toBe(1);
      }
      git(String(dir), "checkout", "-q", "--", "src/aliased.ts");
      rmSync(join(String(dir), "lib.ts"));
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, aliasNames)).toEqual(["exact.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("an import that never resolved claims only the file it names", async () => {
      const optional = (specifier: string) =>
        `import { test, expect } from "bun:test";\nlet optional;\ntry { optional = require("${specifier}"); } catch {}\ntest("optional", () => expect(optional).toBeUndefined());\n`;
      using dir = tempDir("test-changed-rm-beside-unresolved", {
        "package.json": JSON.stringify({ name: "optional", type: "module" }),
        "notes.txt": "notes\n",
        "optionally.ts": lib,
        "sub/optional.ts": lib,
        "docs/guide.md": "guide\n",
        // Other extensions of the names that the imports below end in.
        "config.ts": lib,
        "config.json": "{}\n",
        "styles.css": "a {}\n",
        "test/optional.test.ts": optional("../optional"),
        "test/local.test.ts": optional("../config.local"),
        "test/styles.test.ts": optional("../styles.js"),
        "test/parent.test.ts": `import { test, expect } from "bun:test";\ntest("parent", async () => expect(await import("..").catch(() => null)).toBeNull());\n`,
      });
      initRepo(String(dir));
      const optionalNames = ["optional.test.ts", "local.test.ts", "styles.test.ts", "parent.test.ts"];

      const unnamed = [
        "notes.txt",
        "optionally.ts",
        "sub/optional.ts",
        "docs/guide.md",
        "config.ts",
        "config.json",
        "styles.css",
      ];
      for (const name of unnamed) rmSync(join(String(dir), name));
      {
        const { stderr, exitCode } = await runTestChanged(String(dir));
        expect(ranFiles(stderr, optionalNames)).toEqual([]);
        expect(stderr).toContain("7 changed files, but no test files are affected");
        expect(exitCode).toBe(0);
      }
      // The file that an import names selects its importer.
      writeFileSync(join(String(dir), "optional.ts"), lib);
      writeFileSync(join(String(dir), "config.local.ts"), lib);
      writeFileSync(join(String(dir), "styles.tsx"), lib);
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, optionalNames)).toEqual(["local.test.ts", "optional.test.ts", "styles.test.ts"]);
      expect(exitCode).toBe(1);
    });

    test("an import that is longer than a path", async () => {
      using dir = tempDir("test-changed-long-specifier", {
        "package.json": JSON.stringify({ name: "long", type: "module" }),
        "README.md": "hello\n",
        "long.test.ts": `import { test, expect } from "bun:test";\ntest("long", async () => expect(await import("./${Buffer.alloc(5000, "a").toString()}").catch(() => null)).toBeNull());\n`,
      });
      initRepo(String(dir));
      rmSync(join(String(dir), "README.md"));

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(stderr).toContain("the static imports of 1 test file do not reach README.md\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("the changed files are the ones git knows", () => {
    const listingFixture = {
      "package.json": JSON.stringify({ name: "root" }),
      "app/package.json": JSON.stringify({ name: "app", type: "module" }),
      "app/dep.ts": `export const x = 1;\n`,
      "app/sub.test.ts": `import { test, expect } from "bun:test";\nimport { x } from "./dep";\ntest("sub", () => expect(x).toBe(1));\n`,
      "app/untouched.test.ts": `import { test, expect } from "bun:test";\ntest("untouched", () => expect(1).toBe(1));\n`,
    };

    test("with diff.relative set, from a subdirectory", async () => {
      using dir = tempDir("test-changed-diff-relative", listingFixture);
      initRepo(String(dir));
      git(String(dir), "config", "diff.relative", "true");
      appendFileSync(join(String(dir), "app", "dep.ts"), "// touched\n");

      const { stderr, exitCode } = await runTestChanged(join(String(dir), "app"));
      expect(ranFiles(stderr, ["sub.test.ts", "untouched.test.ts"])).toEqual(["sub.test.ts"]);
      expect(exitCode).toBe(0);
    });

    // Windows does not allow a quote in a file name.
    test.skipIf(isWindows)("a name that git quotes", async () => {
      using dir = tempDir("test-changed-quoted-name", {
        ...listingFixture,
        'app/ the "dep".ts': `export const x = 1;\n`,
        "app/sub.test.ts": `import { test, expect } from "bun:test";\nimport { x } from "./ the \\"dep\\"";\ntest("sub", () => expect(x).toBe(1));\n`,
      });
      initRepo(String(dir));
      appendFileSync(join(String(dir), "app", ' the "dep".ts'), "// touched\n");
      writeFileSync(
        join(String(dir), "app", ' new "one".test.ts'),
        `import { test, expect } from "bun:test";\ntest("new", () => expect(1).toBe(1));\n`,
      );

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, ["sub.test.ts", "untouched.test.ts", ' new "one".test.ts'])).toEqual([
        ' new "one".test.ts',
        "sub.test.ts",
      ]);
      expect(stderr).toContain("2 changed files, running 2/3 test files\n");
      expect(exitCode).toBe(0);
    });
  });

  describe("a change that reaches a preload selects every test file", () => {
    const preloadFixture = {
      "package.json": JSON.stringify({ name: "preloads", type: "module" }),
      "bunfig.toml": `[test]\npreload = ["./setup.ts"]\n`,
      "setup.ts": `import { value } from "./setup-dep";\nglobalThis.fromSetup = value;\n`,
      "setup-dep.ts": `export const value = 1;\n`,
      "cli-setup.ts": `globalThis.fromCli = 1;\n`,
      "lib.ts": `export const v = 1;\n`,
      "one.test.ts": `import { test, expect } from "bun:test";\nimport { v } from "./lib";\ntest("one", () => expect(v).toBe(1));\n`,
      "two.test.ts": `import { test, expect } from "bun:test";\ntest("two", () => expect(globalThis.fromSetup).toBe(1));\n`,
    };
    const preloadNames = ["one.test.ts", "two.test.ts"];

    test("[test] preload in bunfig.toml", async () => {
      using dir = tempDir("test-changed-preload-bunfig", preloadFixture);
      initRepo(String(dir));
      appendFileSync(join(String(dir), "setup.ts"), "// touched\n");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, preloadNames)).toEqual(preloadNames);
      expect(stderr).toContain("1 changed file, running 2/2 test files\n");
      expect(exitCode).toBe(0);
    });

    test("a file the preload imports", async () => {
      using dir = tempDir("test-changed-preload-import", preloadFixture);
      initRepo(String(dir));
      writeFileSync(join(String(dir), "setup-dep.ts"), `export const value = 2;\n`);

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, preloadNames)).toEqual(preloadNames);
      // two.test.ts imports nothing and reads what the preload set.
      expect(stderr).toContain("(fail) two");
      expect(exitCode).toBe(1);
    });

    test("--preload", async () => {
      using dir = tempDir("test-changed-preload-cli", preloadFixture);
      initRepo(String(dir));
      appendFileSync(join(String(dir), "cli-setup.ts"), "// touched\n");

      {
        const { stderr, exitCode } = await runTestChanged(String(dir));
        expect(ranFiles(stderr, preloadNames)).toEqual([]);
        expect(stderr).toContain("the static imports of 2 test files do not reach cli-setup.ts\n");
        expect(exitCode).toBe(0);
      }
      const { stderr, exitCode } = await runTestChanged(String(dir), ["--preload", "./cli-setup.ts"]);
      expect(ranFiles(stderr, preloadNames)).toEqual(preloadNames);
      expect(exitCode).toBe(0);
    });

    test("a deleted preload", async () => {
      using dir = tempDir("test-changed-preload-deleted", preloadFixture);
      initRepo(String(dir));
      rmSync(join(String(dir), "setup.ts"));

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(stderr).toContain("1 changed file, running 2/2 test files\n");
      expect(exitCode).toBe(1);
    });

    test("a deleted preload that a tsconfig paths alias names", async () => {
      using dir = tempDir("test-changed-preload-alias-deleted", {
        ...preloadFixture,
        "bunfig.toml": `[test]\npreload = ["@/setup"]\n`,
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
        "src/setup.ts": `globalThis.fromSetup = 1;\n`,
        "src/unused.ts": `export {};\n`,
      });
      initRepo(String(dir));

      rmSync(join(String(dir), "src", "unused.ts"));
      {
        const { stderr, exitCode } = await runTestChanged(String(dir));
        expect(ranFiles(stderr, preloadNames)).toEqual([]);
        expect(exitCode).toBe(0);
      }
      rmSync(join(String(dir), "src", "setup.ts"));
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(stderr).toContain("2 changed files, running 2/2 test files\n");
      expect(exitCode).toBe(1);
    });

    test("--preload of a file: URL", async () => {
      using dir = tempDir("test-changed-preload-url", preloadFixture);
      initRepo(String(dir));
      appendFileSync(join(String(dir), "cli-setup.ts"), "// touched\n");

      const preload = "file://" + join(String(dir), "cli-setup.ts");
      const { stderr, exitCode } = await runTestChanged(String(dir), ["--preload", preload]);
      expect(ranFiles(stderr, preloadNames)).toEqual(preloadNames);
      expect(exitCode).toBe(0);
    });

    test("a preload that is a workspace package", async () => {
      using dir = tempDir("test-changed-preload-workspace", {
        ...preloadFixture,
        "bunfig.toml": `[test]\npreload = ["setup-pkg"]\n`,
        "packages/setup-pkg/package.json": JSON.stringify({ name: "setup-pkg", main: "index.ts" }),
        "packages/setup-pkg/index.ts": `globalThis.fromSetup = 1;\n`,
        "node_modules/.keep": "",
      });
      symlinkSync(
        join(String(dir), "packages", "setup-pkg"),
        join(String(dir), "node_modules", "setup-pkg"),
        "junction",
      );
      initRepo(String(dir));
      appendFileSync(join(String(dir), "packages", "setup-pkg", "index.ts"), "// touched\n");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, preloadNames)).toEqual(preloadNames);
      expect(exitCode).toBe(0);
    });

    test("a preload in node_modules selects nothing", async () => {
      using dir = tempDir("test-changed-preload-node-modules", {
        ...preloadFixture,
        "bunfig.toml": `[test]\npreload = ["setup-pkg"]\n`,
        "node_modules/setup-pkg/package.json": JSON.stringify({ name: "setup-pkg", main: "index.js" }),
        "node_modules/setup-pkg/index.js": `globalThis.fromSetup = 1;\n`,
      });
      initRepo(String(dir));
      appendFileSync(join(String(dir), "node_modules", "setup-pkg", "index.js"), "// touched\n");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, preloadNames)).toEqual([]);
      expect(stderr).toContain("1 changed file, but no test files are affected");
      expect(exitCode).toBe(0);
    });

    test("a preload that names no package selects nothing", async () => {
      using dir = tempDir("test-changed-preload-no-package", {
        ...preloadFixture,
        "bunfig.toml": `[test]\npreload = ["not-installed"]\n`,
        "README.md": "hello\n",
      });
      initRepo(String(dir));
      appendFileSync(join(String(dir), "README.md"), "more\n");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, preloadNames)).toEqual([]);
      expect(stderr).toContain("the static imports of 2 test files do not reach README.md\n");
      expect(exitCode).toBe(0);
    });

    test("a change that reaches no preload selects by the imports alone", async () => {
      using dir = tempDir("test-changed-preload-untouched", preloadFixture);
      initRepo(String(dir));
      appendFileSync(join(String(dir), "lib.ts"), "// touched\n");

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, preloadNames)).toEqual(["one.test.ts"]);
      expect(exitCode).toBe(0);
    });
  });

  test("multiple changes select the union of affected tests", async () => {
    using dir = tempDir("test-changed-multi", fixture);
    initRepo(String(dir));

    appendFileSync(join(String(dir), "src", "helper.ts"), "// touched\n");
    appendFileSync(join(String(dir), "src", "other.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual(["a.test.ts", "b.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("shared dependency selects all importers", async () => {
    using dir = tempDir("test-changed-shared", {
      "package.json": JSON.stringify({ name: "shared", type: "module" }),
      "shared.ts": `export const v = 1;\n`,
      "one.test.ts": `import { test, expect } from "bun:test";\nimport { v } from "./shared";\ntest("one", () => expect(v).toBe(1));\n`,
      "two.test.ts": `import { test, expect } from "bun:test";\nimport { v } from "./shared";\ntest("two", () => expect(v).toBe(1));\n`,
      "three.test.ts": `import { test, expect } from "bun:test";\ntest("three", () => expect(1).toBe(1));\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "shared.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, ["one.test.ts", "two.test.ts", "three.test.ts"])).toEqual(["one.test.ts", "two.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("a file imported under two import attributes selects all importers", async () => {
    // data.json is two modules in the graph: one per loader.
    using dir = tempDir("test-changed-two-attributes", {
      "package.json": JSON.stringify({ name: "two-attributes", type: "module" }),
      "data.json": `{"v":1}\n`,
      "one.test.ts": `import { test, expect } from "bun:test";\nimport data from "./data.json";\ntest("one", () => expect(data.v).toBe(1));\n`,
      "two.test.ts": `import { test, expect } from "bun:test";\nimport text from "./data.json" with { type: "text" };\ntest("two", () => expect(text).toContain("v"));\n`,
      "three.test.ts": `import { test, expect } from "bun:test";\ntest("three", () => expect(1).toBe(1));\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "data.json"), "\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, ["one.test.ts", "two.test.ts", "three.test.ts"])).toEqual(["one.test.ts", "two.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("staged changes are picked up", async () => {
    using dir = tempDir("test-changed-staged", fixture);
    initRepo(String(dir));

    appendFileSync(join(String(dir), "src", "other.ts"), "// touched\n");
    git(String(dir), "add", "-A");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual(["b.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("untracked test file is picked up", async () => {
    using dir = tempDir("test-changed-untracked", fixture);
    initRepo(String(dir));

    writeFileSync(
      join(String(dir), "new.test.ts"),
      `import { test, expect } from "bun:test";\ntest("new", () => expect(1).toBe(1));\n`,
    );

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, [...names, "new.test.ts"])).toEqual(["new.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("--changed=<ref> compares against a commit", async () => {
    using dir = tempDir("test-changed-ref", fixture);
    initRepo(String(dir));

    // Make a second commit that touches helper.ts.
    appendFileSync(join(String(dir), "src", "helper.ts"), "// v2\n");
    git(String(dir), "add", "-A");
    git(String(dir), "commit", "-q", "-m", "v2");

    // Working tree is clean, so bare --changed should run nothing.
    {
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, names)).toEqual([]);
      expect(exitCode).toBe(0);
    }

    // Against HEAD~1, helper.ts changed -> a.test.ts is selected.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed=HEAD~1"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("a.test.ts:");
    expect(ranFiles(stderr, names)).toEqual(["a.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("--changed=<ref> includes untracked files", async () => {
    using dir = tempDir("test-changed-ref-untracked", fixture);
    initRepo(String(dir));

    // Two commits so HEAD~1 is valid; working tree is clean.
    appendFileSync(join(String(dir), "src", "helper.ts"), "// v2\n");
    git(String(dir), "add", "-A");
    git(String(dir), "commit", "-q", "-m", "v2");

    // Create a brand-new untracked test file. It did not exist at
    // HEAD~1, so it is "changed since HEAD~1" even though
    // `git diff --name-only HEAD~1` never lists untracked files.
    writeFileSync(
      join(String(dir), "new.test.ts"),
      `import { test, expect } from "bun:test";\ntest("new", () => expect(1).toBe(1));\n`,
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed=HEAD~1"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // a.test.ts (helper.ts changed between HEAD~1 and HEAD) and the
    // brand-new untracked file should both run.
    expect(ranFiles(stderr, [...names, "new.test.ts"])).toEqual(["a.test.ts", "new.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("change inside node_modules does not select any test", async () => {
    using dir = tempDir("test-changed-nm", {
      "package.json": JSON.stringify({ name: "nm", type: "module" }),
      "node_modules/fake-pkg/package.json": JSON.stringify({
        name: "fake-pkg",
        version: "1.0.0",
        main: "index.js",
      }),
      "node_modules/fake-pkg/index.js": `module.exports = { value: 1 };\n`,
      "pkg.test.ts": `import { test, expect } from "bun:test";\nimport pkg from "fake-pkg";\ntest("pkg", () => expect(pkg.value).toBe(1));\n`,
    });
    initRepo(String(dir));

    appendFileSync(join(String(dir), "node_modules", "fake-pkg", "index.js"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    // node_modules are not entered by the module graph scan, so changing
    // a file there should not select pkg.test.ts.
    expect(ranFiles(stderr, ["pkg.test.ts"])).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("works from a subdirectory of the git repo", async () => {
    using dir = tempDir("test-changed-subdir", {
      "package.json": JSON.stringify({ name: "root" }),
      "app/package.json": JSON.stringify({ name: "app", type: "module" }),
      "app/dep.ts": `export const x = 1;\n`,
      "app/sub.test.ts": `import { test, expect } from "bun:test";\nimport { x } from "./dep";\ntest("sub", () => expect(x).toBe(1));\n`,
      "app/untouched.test.ts": `import { test, expect } from "bun:test";\ntest("untouched", () => expect(1).toBe(1));\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "app", "dep.ts"), "// touched\n");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed"],
      cwd: join(String(dir), "app"),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(ranFiles(stderr, ["sub.test.ts", "untouched.test.ts"])).toEqual(["sub.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("untracked test file in a subdirectory is picked up", async () => {
    // `git ls-files --others` prints cwd-relative paths unless --full-name
    // is passed; this exercises that path join.
    using dir = tempDir("test-changed-subdir-untracked", {
      "package.json": JSON.stringify({ name: "root" }),
      "app/package.json": JSON.stringify({ name: "app", type: "module" }),
      "app/base.test.ts": `import { test, expect } from "bun:test";\ntest("base", () => expect(1).toBe(1));\n`,
    });
    initRepo(String(dir));
    writeFileSync(
      join(String(dir), "app", "brand-new.test.ts"),
      `import { test, expect } from "bun:test";\ntest("brand-new", () => expect(1).toBe(1));\n`,
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed"],
      cwd: join(String(dir), "app"),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(ranFiles(stderr, ["base.test.ts", "brand-new.test.ts"])).toEqual(["brand-new.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("errors helpfully outside a git repo", async () => {
    using dir = tempDir("test-changed-nogit", {
      "package.json": JSON.stringify({ name: "nogit" }),
      "only.test.ts": `import { test } from "bun:test";\ntest("only", () => {});\n`,
    });

    // Ensure git cannot discover a parent repository above the temp dir
    // (CI checkouts sometimes place /tmp inside the repo's worktree).
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed"],
      cwd: String(dir),
      env: { ...gitEnv, GIT_CEILING_DIRECTORIES: String(dir), GIT_DIR: join(String(dir), "no-such-git-dir") },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.toLowerCase()).toContain("git");
    expect(exitCode).not.toBe(0);
  });

  test("test with a syntax-error dependency still filters by changed path", async () => {
    // The module graph scan is best-effort; a parse error in one file must
    // not abort filtering for the rest.
    using dir = tempDir("test-changed-parseerr", {
      "package.json": JSON.stringify({ name: "pe", type: "module" }),
      "good.ts": `export const g = 1;\n`,
      "good.test.ts": `import { test, expect } from "bun:test";\nimport { g } from "./good";\ntest("good", () => expect(g).toBe(1));\n`,
      "bad.test.ts": `import { test } from "bun:test";\nimport { nope } from "./does-not-exist";\ntest("bad", () => {});\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "good.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(stderr).toContain("good.test.ts:");
    expect(stderr).not.toContain("bad.test.ts:");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/29590: a tsconfig `paths` alias
  // like "@/*" must be followed when building the module graph.
  test("tsconfig paths alias is followed when computing the module graph", async () => {
    using dir = tempDir("test-changed-tsconfig-paths", {
      "package.json": JSON.stringify({ name: "aliasrepro", type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
      }),
      "src/adder.ts": `export const add = (a: number, b: number) => a + b;\n`,
      "tests/alias.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "@/src/adder";\ntest("alias", () => expect(add(1, 2)).toBe(3));\n`,
      "tests/relative.test.ts": `import { test, expect } from "bun:test";\nimport { add } from "../src/adder";\ntest("relative", () => expect(add(1, 2)).toBe(3));\n`,
      "tests/unrelated.test.ts": `import { test, expect } from "bun:test";\ntest("unrelated", () => expect(1).toBe(1));\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "src", "adder.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    const testNames = ["alias.test.ts", "relative.test.ts", "unrelated.test.ts"];
    expect(ranFiles(stderr, testNames)).toEqual(["alias.test.ts", "relative.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("a scan that cannot start ends the threads it started", async () => {
    using dir = tempDir("test-changed-scan-fails", {
      "a.test.js": `
import { test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
const isPool = tid => {
  try {
    return readFileSync("/proc/self/task/" + tid + "/comm", "utf8").startsWith("Bun Pool");
  } catch {
    return false;
  }
};
test("threads", () => {
  // The kernel lists a thread for a moment after it is joined.
  const deadline = performance.now() + 2000;
  let left;
  while ((left = readdirSync("/proc/self/task").filter(isPool).length) && performance.now() < deadline);
  console.log(left);
});
`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "a.test.js"), "// touched\n");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed", "--tsconfig-override", "missing.json"],
      cwd: String(dir),
      // The scan's transpiler is left to the exit.
      env: { ...gitEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("failed to build module graph");
    expect(stdout.trim().split("\n").at(-1)).toBe("0");
    expect(exitCode).toBe(0);
  });

  test("a node:vm timeout can interrupt a hot loop", async () => {
    using dir = tempDir("test-changed-vm-timeout", {
      "package.json": JSON.stringify({ name: "vm-timeout", type: "module" }),
      "hot.test.ts": `import { test, expect } from "bun:test";
import vm from "node:vm";
test("hot", () => {
  const code = "let i = 0; function f(x) { return x + 1 } while (true) { i = f(i) }";
  expect(() => vm.runInNewContext(code, {}, { timeout: 100 })).toThrow("timed out");
});
`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "hot.test.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});

// On Windows, `bun test --watch` runs as a parent watcher-manager that
// respawns a child process on change (rather than exec()-in-place), which
// makes this test's stderr-stream sync points racy there. The 15 cases
// above fully cover the --changed filtering logic on Windows; this case
// only verifies composition with --watch.
describe.skipIf(isWindows)("bun test --changed --watch", () => {
  test("restarts and reruns only affected tests when a dependency changes", async () => {
    using dir = tempDir("test-changed-watch", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "dep-a.ts": `export const A = 1;\n`,
      "dep-b.ts": `export const B = 2;\n`,
      "wa.test.ts": `import { test, expect } from "bun:test";\nimport { A } from "./dep-a";\ntest("wa", () => expect(A).toBe(1));\n`,
      "wb.test.ts": `import { test, expect } from "bun:test";\nimport { B } from "./dep-b";\ntest("wb", () => expect(B).toBe(2));\n`,
    });
    initRepo(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed", "--watch", "--no-clear-screen"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    async function waitFor(needle: string, from = 0): Promise<void> {
      while (!buf.slice(from).includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed before seeing ${JSON.stringify(needle)}\n${buf}`);
        buf += decoder.decode(value, { stream: true });
      }
    }

    // Initial run: nothing changed. Wait for the summary so the watcher is
    // fully seeded before we touch anything.
    await waitFor("no changed files");
    await waitFor("Ran 0 tests");
    expect(buf).not.toContain("wa.test.ts:");
    expect(buf).not.toContain("wb.test.ts:");

    // Touch dep-a.ts: watcher restarts, --changed now sees an uncommitted
    // change to dep-a.ts and should run only wa.test.ts. Sync on the
    // end-of-run summary rather than the file header so the child is
    // quiescent (watcher seeded, tests done) before the next touch.
    const before = buf.length;
    appendFileSync(join(String(dir), "dep-a.ts"), "// touched\n");
    await waitFor("Ran 1 test across 1 file", before);
    const afterA = buf.slice(before);
    expect(ranFiles(afterA, ["wa.test.ts", "wb.test.ts"])).toEqual(["wa.test.ts"]);

    // Touch dep-b.ts: dep-a is still uncommitted in git, but the watcher
    // only saw dep-b change this restart, so only wb.test.ts should run.
    const before2 = buf.length;
    appendFileSync(join(String(dir), "dep-b.ts"), "// touched\n");
    await waitFor("Ran 1 test across 1 file", before2);
    const afterB = buf.slice(before2);
    expect(ranFiles(afterB, ["wa.test.ts", "wb.test.ts"])).toEqual(["wb.test.ts"]);

    proc.kill();
    reader.releaseLock();
  }, 60_000);

  // Regression for: with two uncommitted test files, editing one of them
  // during --changed --watch should only re-run that one, not both.
  test("editing one of several dirty test files reruns only that one", async () => {
    using dir = tempDir("test-changed-watch-narrow", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "wa.test.ts": `import { test, expect } from "bun:test";\ntest("wa", () => expect(1).toBe(1));\n`,
      "wb.test.ts": `import { test, expect } from "bun:test";\ntest("wb", () => expect(2).toBe(2));\n`,
    });
    initRepo(String(dir));
    // Make both test files dirty (uncommitted) before starting the watcher.
    appendFileSync(join(String(dir), "wa.test.ts"), "// dirty\n");
    appendFileSync(join(String(dir), "wb.test.ts"), "// dirty\n");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed", "--watch", "--no-clear-screen"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    async function waitFor(needle: string, from = 0): Promise<void> {
      while (!buf.slice(from).includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed before seeing ${JSON.stringify(needle)}\n${buf}`);
        buf += decoder.decode(value, { stream: true });
      }
    }

    // Initial run: git reports both test files changed, so both run.
    await waitFor("Ran 2 tests across 2 files");
    expect(ranFiles(buf, ["wa.test.ts", "wb.test.ts"])).toEqual(["wa.test.ts", "wb.test.ts"]);

    // Now edit only wa.test.ts. The watcher passes exactly that path to
    // the restarted process; wb.test.ts (though still dirty in git) is
    // not in its DAG, so it must not re-run.
    const before = buf.length;
    appendFileSync(join(String(dir), "wa.test.ts"), "// touched again\n");
    await waitFor("Ran 1 test across 1 file", before);
    const after = buf.slice(before);
    expect(ranFiles(after, ["wa.test.ts", "wb.test.ts"])).toEqual(["wa.test.ts"]);

    proc.kill();
    reader.releaseLock();
  }, 60_000);

  test.skipIf(!isLinux)("editing many test files at once reruns all of them", async () => {
    const names = Array.from({ length: 12 }, (_, i) => `many-${i}.test.ts`);
    using dir = tempDir("test-changed-watch-many", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      ...Object.fromEntries(names.map(name => [name, `import { test } from "bun:test";\ntest("t", () => {});\n`])),
    });
    initRepo(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed", "--watch", "--no-clear-screen"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
      killSignal: "SIGKILL",
    });
    const lines = forEachLine(proc.stderr);
    async function nextSummary() {
      while (true) {
        const { value, done } = await lines.next();
        if (done || value.startsWith("Ran ")) return value?.replace(/ \[.*/, "");
      }
    }
    expect(await nextSummary()).toBe("Ran 0 tests across 0 files.");

    // Stopped, so that the watcher gets them in one batch.
    proc.kill("SIGSTOP");
    await untilEveryThreadIs("T", proc.pid);
    for (const name of names) appendFileSync(join(String(dir), name), "// touched\n");
    proc.kill("SIGCONT");
    expect(await nextSummary()).toBe("Ran 12 tests across 12 files.");
  });

  // Reads each run: the test files it ran and its `Ran N tests across M files.` line.
  function runsOf(cwd: string) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed", "--watch", "--no-clear-screen"],
      cwd,
      env: gitEnv,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
      killSignal: "SIGKILL",
    });
    const lines = forEachLine(proc.stderr);
    return {
      proc,
      async next() {
        const files: string[] = [];
        while (true) {
          const { value, done } = await lines.next();
          if (done) return { files, summary: undefined };
          if (value.endsWith(".test.ts:")) files.push(value.slice(0, -1));
          if (value.startsWith("Ran ")) return { files: files.sort(), summary: value.replace(/ \[.*/, "") };
        }
      },
    };
  }

  test("an edit of a preload restarts a run of no test files and reruns every test file", async () => {
    using dir = tempDir("test-changed-watch-preload", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "bunfig.toml": `[test]\npreload = ["./setup.ts"]\n`,
      "setup.ts": `globalThis.fromSetup = 1;\n`,
      "wa.test.ts": `import { test, expect } from "bun:test";\ntest("wa", () => expect(1).toBe(1));\n`,
      "wb.test.ts": `import { test, expect } from "bun:test";\ntest("wb", () => expect(2).toBe(2));\n`,
    });
    initRepo(String(dir));

    const runs = runsOf(String(dir));
    await using proc = runs.proc;
    expect(await runs.next()).toEqual({ files: [], summary: "Ran 0 tests across 0 files." });

    appendFileSync(join(String(dir), "setup.ts"), "// touched\n");
    expect(await runs.next()).toEqual({ files: ["wa.test.ts", "wb.test.ts"], summary: "Ran 2 tests across 2 files." });
  }, 60_000);

  const watchFixture = {
    "package.json": JSON.stringify({ name: "watch", type: "module" }),
    "dep-a.ts": `export const A = 1;\n`,
    "wa.test.ts": `import { test, expect } from "bun:test";\nimport { A } from "./dep-a";\ntest("wa", () => expect(A).toBe(1));\n`,
    "wb.test.ts": `import { test, expect } from "bun:test";\ntest("wb", () => expect(2).toBe(2));\n`,
    "wc.test.ts": `import { test, expect } from "bun:test";\ntest("wc", () => expect(3).toBe(3));\n`,
  };

  test("a deleted dependency reruns its importer, and no other file that git calls changed", async () => {
    using dir = tempDir("test-changed-watch-delete", watchFixture);
    initRepo(String(dir));
    appendFileSync(join(String(dir), "wb.test.ts"), "// dirty\n");

    const runs = runsOf(String(dir));
    await using proc = runs.proc;
    expect(await runs.next()).toEqual({ files: ["wb.test.ts"], summary: "Ran 1 test across 1 file." });

    rmSync(join(String(dir), "dep-a.ts"));
    expect(await runs.next()).toEqual({ files: ["wa.test.ts"], summary: "Ran 1 test across 1 file." });
  }, 60_000);

  test("a renamed test file runs under its new name", async () => {
    using dir = tempDir("test-changed-watch-rename", watchFixture);
    initRepo(String(dir));
    appendFileSync(join(String(dir), "wb.test.ts"), "// dirty\n");

    const runs = runsOf(String(dir));
    await using proc = runs.proc;
    expect(await runs.next()).toEqual({ files: ["wb.test.ts"], summary: "Ran 1 test across 1 file." });

    // The watcher knows the old name alone. Git lists the new one.
    renameSync(join(String(dir), "wc.test.ts"), join(String(dir), "wd.test.ts"));
    expect(await runs.next()).toEqual({ files: ["wb.test.ts", "wd.test.ts"], summary: "Ran 2 tests across 2 files." });
  }, 60_000);

  test("a renamed test file whose name has capitals runs under its new name", async () => {
    using dir = tempDir("test-changed-watch-rename-capitals", {
      ...watchFixture,
      "Upper.Test.ts": watchFixture["wc.test.ts"],
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "wb.test.ts"), "// dirty\n");

    const runs = runsOf(String(dir));
    await using proc = runs.proc;
    expect(await runs.next()).toEqual({ files: ["wb.test.ts"], summary: "Ran 1 test across 1 file." });

    renameSync(join(String(dir), "Upper.Test.ts"), join(String(dir), "renamed.test.ts"));
    expect(await runs.next()).toEqual({
      files: ["renamed.test.ts", "wb.test.ts"],
      summary: "Ran 2 tests across 2 files.",
    });
  }, 60_000);

  // Linux only: it stops the process until /proc says that every thread is stopped.
  test.skipIf(!isLinux)(
    "a dependency deleted together with its import reruns the importer alone",
    async () => {
      using dir = tempDir("test-changed-watch-delete-with-import", watchFixture);
      initRepo(String(dir));
      appendFileSync(join(String(dir), "wb.test.ts"), "// dirty\n");

      const runs = runsOf(String(dir));
      await using proc = runs.proc;
      expect(await runs.next()).toEqual({ files: ["wb.test.ts"], summary: "Ran 1 test across 1 file." });

      // Stopped, so that the watcher gets both in one batch.
      proc.kill("SIGSTOP");
      await untilEveryThreadIs("T", proc.pid);
      rmSync(join(String(dir), "dep-a.ts"));
      writeFileSync(join(String(dir), "wa.test.ts"), watchFixture["wc.test.ts"]);
      proc.kill("SIGCONT");
      expect(await runs.next()).toEqual({ files: ["wa.test.ts"], summary: "Ran 1 test across 1 file." });
    },
    60_000,
  );

  test("trigger file path handed to restarted runs has a 128-bit random hex suffix", async () => {
    using dir = tempDir("test-changed-watch-trigger-name", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "dep-a.ts": `export const A = 1;\n`,
      "wa.test.ts": `import { test, expect } from "bun:test";\nimport { A } from "./dep-a";\ntest("wa", () => { console.error("TRIGGER=" + JSON.stringify(process.env.BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE ?? null)); expect(A).toBe(1); });\n`,
    });
    initRepo(String(dir));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--changed", "--watch", "--no-clear-screen"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "ignore",
      stderr: "pipe",
      stdin: "ignore",
    });

    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    async function waitFor(needle: string, from = 0): Promise<void> {
      while (!buf.slice(from).includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed before seeing ${JSON.stringify(needle)}\n${buf}`);
        buf += decoder.decode(value, { stream: true });
      }
    }

    await waitFor("no changed files");
    await waitFor("Ran 0 tests");

    const before = buf.length;
    appendFileSync(join(String(dir), "dep-a.ts"), "// touched\n");
    await waitFor("Ran 1 test across 1 file", before);
    const after = buf.slice(before);
    const match = after.match(/TRIGGER=(.*)/);
    expect(match).not.toBeNull();
    const triggerPath = JSON.parse(match![1]);
    expect(typeof triggerPath).toBe("string");
    expect(basename(triggerPath)).toMatch(/^\.bun-test-changed-[0-9a-f]{32}\.trigger$/);

    proc.kill();
    reader.releaseLock();
  }, 60_000);
});
