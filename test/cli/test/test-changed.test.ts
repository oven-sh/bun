import { spawnSync } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, MAX_PATH_BYTES, tempDir, tmpdirSync } from "harness";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, truncateSync, writeFileSync } from "node:fs";
import { basename, delimiter, join } from "node:path";

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
  flag = "--changed",
  env: Record<string, string | undefined> = gitEnv,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", flag, ...extra],
    cwd,
    env,
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

// Stands in for git where no state of a real repository gives the answer. It
// fails the command named by STAND_IN_FAILS the way git reports a fatal error,
// and it answers the command named by STAND_IN_ANSWERS with STAND_IN_ANSWER.
// It is a shell script, so the cases that use it skip Windows.
const gitStandIn = `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "$STAND_IN_FAILS" ]; then
    echo "fatal: the stand-in for git does not run $arg" >&2
    exit 128
  fi
  if [ "$arg" = "$STAND_IN_ANSWERS" ]; then
    printf '%s\\n' "$STAND_IN_ANSWER"
    exit 0
  fi
done
exec "$STAND_IN_GIT" "$@"
`;

/** Writes the stand-in for git into `dir` and returns the environment that finds it before git. */
function standInEnv(
  dir: string,
  vars: { STAND_IN_FAILS?: string; STAND_IN_ANSWERS?: string; STAND_IN_ANSWER?: string },
) {
  const bin = join(dir, "stand-in");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), gitStandIn, { mode: 0o755 });
  return { ...gitEnv, ...vars, PATH: bin + delimiter + gitEnv.PATH, STAND_IN_GIT: Bun.which("git")! };
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
    expect(stderr).toContain("no test files are affected");
    expect(exitCode).toBe(0);
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

  const passingTest = (name: string, dependency?: string) =>
    `import { test, expect } from "bun:test";\n` +
    (dependency ? `import { value } from ${JSON.stringify(dependency)};\n` : `const value = 1;\n`) +
    `test(${JSON.stringify(name)}, () => expect(value).toBe(1));\n`;

  const monorepo = {
    "package.json": JSON.stringify({ name: "root", private: true }),
    "packages/a/package.json": JSON.stringify({ name: "a", type: "module" }),
    "packages/a/a.test.ts": passingTest("a", "../b/value"),
    "packages/a/local.ts": `export const value = 1;\n`,
    "packages/a/local.test.ts": passingTest("local", "./local"),
    "packages/a/plain.test.ts": passingTest("plain"),
    "packages/b/package.json": JSON.stringify({ name: "b", type: "module" }),
    "packages/b/value.js": `export const value = 1;\n`,
  };
  const monorepoTests = ["a.test.ts", "fresh.test.ts", "local.test.ts", "plain.test.ts"];

  // `git ls-files` lists only what is below its cwd unless a pathspec names
  // more. The pathspec keeps its meaning under the pathspec variables that a
  // git hook or a wrapper can export.
  test.each([
    { flag: "--changed", ran: ["a.test.ts"] },
    { flag: "--changed=HEAD", ran: ["a.test.ts"] },
    { flag: "--changed", fromRoot: true, ran: ["a.test.ts"] },
    { flag: "--changed", args: ["./", "../b"], ran: ["a.test.ts", "fresh.test.ts"] },
    { flag: "--changed=HEAD", args: ["./", "../b"], ran: ["a.test.ts", "fresh.test.ts"] },
    { flag: "--changed", env: { GIT_GLOB_PATHSPECS: "1" }, ran: ["a.test.ts"] },
    { flag: "--changed", env: { GIT_LITERAL_PATHSPECS: "1" }, ran: ["a.test.ts"] },
  ])("untracked file outside the cwd is a changed file: %j", async ({ flag, fromRoot, args = [], env, ran }) => {
    using dir = tempDir("test-changed-untracked-outside-cwd", monorepo);
    initRepo(String(dir));
    // A new file that `../b/value` now resolves to in place of value.js, and a new test.
    writeFileSync(join(String(dir), "packages", "b", "value.ts"), `export const value = 1;\n`);
    writeFileSync(join(String(dir), "packages", "b", "fresh.test.ts"), passingTest("fresh"));

    const { stderr, exitCode } = fromRoot
      ? await runTestChanged(String(dir), ["--cwd", join("packages", "a")], flag)
      : await runTestChanged(join(String(dir), "packages", "a"), args, flag, { ...gitEnv, ...env });
    expect(ranFiles(stderr, monorepoTests)).toEqual(ran);
    expect(exitCode).toBe(0);
  });

  // The other side of the wider list: an untracked file that no test here
  // imports counts as a change, and a file that .gitignore names does not.
  test.each(["--changed", "--changed=HEAD"])("%s counts an untracked file that no test imports", async flag => {
    using dir = tempDir("test-changed-untracked-unrelated", {
      ...monorepo,
      "packages/b/.gitignore": "generated.ts\n",
      "packages/a/generated.test.ts": passingTest("generated", "../b/generated"),
    });
    initRepo(String(dir));
    writeFileSync(join(String(dir), "packages", "b", "generated.ts"), `export const value = 1;\n`);
    writeFileSync(join(String(dir), "packages", "b", "notes.txt"), "notes\n");

    const { stderr, exitCode } = await runTestChanged(join(String(dir), "packages", "a"), [], flag);
    expect(stderr).toContain("--changed: 1 changed file, but no test files are affected\n");
    expect(ranFiles(stderr, [...monorepoTests, "generated.test.ts"])).toEqual([]);
    expect(exitCode).toBe(0);
  });

  // Git lists a repository inside the work tree (a clone, or the target of
  // `git worktree add`) as `nested/` and names no file in it.
  test.each([".", join("packages", "a")])("untracked nested repository is not a changed file (cwd %s)", async cwd => {
    using dir = tempDir("test-changed-nested-repository", monorepo);
    initRepo(String(dir));
    const nested = join(String(dir), "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "lib.ts"), `export const value = 1;\n`);
    initRepo(nested);

    const { stderr, exitCode } = await runTestChanged(join(String(dir), cwd));
    expect(stderr).toContain("--changed: no changed files, nothing to run\n");
    expect(ranFiles(stderr, monorepoTests)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  // With `diff.relative` set, `git diff` lists only the files below the cwd, by
  // names relative to the cwd.
  test.each(["--changed", "--changed=HEAD"])("diff.relative does not change what %s lists", async flag => {
    using dir = tempDir("test-changed-diff-relative", monorepo);
    initRepo(String(dir));
    git(String(dir), "config", "diff.relative", "true");
    appendFileSync(join(String(dir), "packages", "b", "value.js"), "// touched\n");
    appendFileSync(join(String(dir), "packages", "a", "local.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(join(String(dir), "packages", "a"), [], flag);
    expect(ranFiles(stderr, monorepoTests)).toEqual(["a.test.ts", "local.test.ts"]);
    expect(exitCode).toBe(0);
  });

  // With rename detection `git diff` lists a rename by its new name only. Here
  // the old name is still on disk: the file is taken out of the index and a
  // copy is added under a new name.
  test.each(["--changed", "--changed=HEAD"])(
    "%s lists a file that is untracked and copied to a new name",
    async flag => {
      using dir = tempDir("test-changed-untrack-and-copy", {
        "package.json": JSON.stringify({ name: "untrack-and-copy", type: "module" }),
        "config.ts": `export const host = "localhost";\nexport const port = 8080;\nexport const value = 1;\n`,
        "config.test.ts": passingTest("config", "./config.ts"),
        "plain.test.ts": passingTest("plain"),
      });
      initRepo(String(dir));
      git(String(dir), "rm", "-q", "--cached", "config.ts");
      writeFileSync(join(String(dir), ".gitignore"), "config.ts\n");
      copyFileSync(join(String(dir), "config.ts"), join(String(dir), "config.example.ts"));
      git(String(dir), "add", ".gitignore", "config.example.ts");
      appendFileSync(join(String(dir), "config.ts"), "// a local edit\n");

      const { stderr, exitCode } = await runTestChanged(String(dir), [], flag);
      expect(ranFiles(stderr, ["config.test.ts", "plain.test.ts"])).toEqual(["config.test.ts"]);
      expect(exitCode).toBe(0);
    },
  );

  // Git prints a name in C quotes when it holds a quote, a control character
  // or a byte above 0x7f, unless it is asked for NUL-terminated names. A reader
  // that splits on line breaks and trims blanks loses the other names. Windows
  // cannot hold a quote, a tab or a line break in a file name. The accented
  // name is precomposed, so that row is about the quotes and not about the
  // form that macOS stores.
  const oddNames = [
    " dep.ts",
    "d\u00e9p-\u65e5\u672c.ts",
    ...(isWindows ? [] : ['de"p.ts', "de\tp.ts", "de\np.ts", "de\rp.ts"]),
  ];
  test.each(oddNames)("change to a dependency named %j selects the importing test", async name => {
    using dir = tempDir("test-changed-odd-name", {
      "package.json": JSON.stringify({ name: "odd-name", type: "module" }),
      [name]: `export const value = 1;\n`,
      "odd.test.ts": passingTest("odd", "./" + name),
      "plain.test.ts": passingTest("plain"),
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), name), "// touched\n");

    for (const flag of ["--changed", "--changed=HEAD"]) {
      const { stderr, exitCode } = await runTestChanged(String(dir), [], flag);
      expect(ranFiles(stderr, ["odd.test.ts", "plain.test.ts"])).toEqual(["odd.test.ts"]);
      expect(exitCode).toBe(0);
    }
  });

  // Windows removes a trailing blank from a name and cannot hold a line break in one.
  test.skipIf(isWindows).each(["repo ", "repo\n"])("works in a repository directory named %j", async repo => {
    using dir = tempDir("test-changed-odd-root", {
      [repo + "/package.json"]: JSON.stringify({ name: "odd-root", type: "module" }),
      [repo + "/dep.ts"]: `export const value = 1;\n`,
      [repo + "/dep.test.ts"]: passingTest("dep", "./dep"),
      [repo + "/plain.test.ts"]: passingTest("plain"),
    });
    const root = join(String(dir), repo);
    initRepo(root);
    appendFileSync(join(root, "dep.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(root);
    expect(ranFiles(stderr, ["dep.test.ts", "plain.test.ts"])).toEqual(["dep.test.ts"]);
    expect(exitCode).toBe(0);
  });

  // Git then prints the work tree where it prints `../` segments otherwise, and
  // it runs each command at the root of the work tree. The work tree has a line
  // break in its name where the system can hold one.
  test.each(["--changed", "--changed=HEAD"])("cwd outside the work tree (GIT_WORK_TREE): %s", async flag => {
    const repo = isWindows ? "repo" : "re\npo";
    using dir = tempDir("test-changed-work-tree", {
      [repo + "/package.json"]: JSON.stringify({ name: "work-tree", type: "module" }),
      [repo + "/ dep.ts"]: `export const value = 1;\n`,
      "tests/package.json": JSON.stringify({ name: "tests", type: "module" }),
      "tests/edited.test.ts": passingTest("edited", `../${repo}/ dep.ts`),
      "tests/added.test.ts": passingTest("added", `../${repo}/new.ts`),
      "tests/plain.test.ts": passingTest("plain"),
    });
    const root = join(String(dir), repo);
    initRepo(root);
    appendFileSync(join(root, " dep.ts"), "// touched\n");
    writeFileSync(join(root, "new.ts"), `export const value = 1;\n`);

    const { stderr, exitCode } = await runTestChanged(join(String(dir), "tests"), [], flag, {
      ...gitEnv,
      GIT_DIR: join(root, ".git"),
      GIT_WORK_TREE: root,
    });
    expect(ranFiles(stderr, ["added.test.ts", "edited.test.ts", "plain.test.ts"])).toEqual([
      "added.test.ts",
      "edited.test.ts",
    ]);
    expect(exitCode).toBe(0);
  });

  // Without a commit `git diff HEAD` fails, and the list comes from `git diff`,
  // `git diff --cached` and `git ls-files`. The leading blank shows that each
  // of the three is read as git wrote it.
  test("repository with no commits lists staged, unstaged and untracked files", async () => {
    const names = [" fresh.test.ts", " intent.test.ts", " staged.test.ts", "ignored.test.ts"];
    using dir = tempDir("test-changed-no-commits", {
      "package.json": JSON.stringify({ name: "no-commits", type: "module" }),
      ".gitignore": "ignored.test.ts\n",
      ...Object.fromEntries(names.map(name => [name, passingTest(name)])),
    });
    git(String(dir), "init", "-q");
    git(String(dir), "add", "--", "package.json", ".gitignore", " staged.test.ts");
    git(String(dir), "add", "--intent-to-add", "--", " intent.test.ts");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual([" fresh.test.ts", " intent.test.ts", " staged.test.ts"]);
    expect(exitCode).toBe(0);
  });

  test("git failure is an error, not an empty list of changes", async () => {
    using dir = tempDir("test-changed-git-fails", fixture);
    initRepo(String(dir));
    appendFileSync(join(String(dir), "c.test.ts"), "// touched\n");
    // Every `git diff` and `git ls-files` fails on an index that is cut short.
    truncateSync(join(String(dir), ".git", "index"), 20);

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(stderr).toContain("error: --changed: fatal:");
    expect(ranFiles(stderr, names)).toEqual([]);
    expect(exitCode).toBe(1);
  });

  // A damaged index fails every listing at once. The stand-in fails one command
  // alone. It fails each `git diff`, because a bare --changed reads a failure
  // of `git diff HEAD` alone as a repository with no commits.
  test.skipIf(isWindows).each([
    { flag: "--changed", fails: "diff" },
    { flag: "--changed", fails: "ls-files" },
    { flag: "--changed=HEAD", fails: "ls-files" },
  ])("failing git listing is an error, not an empty list: %j", async ({ flag, fails }) => {
    using dir = tempDir("test-changed-listing-fails", fixture);
    initRepo(String(dir));
    // One change for `git diff` to list and one for `git ls-files`.
    appendFileSync(join(String(dir), "src", "other.ts"), "// touched\n");
    writeFileSync(join(String(dir), "new.test.ts"), passingTest("new"));

    const env = standInEnv(String(dir), { STAND_IN_FAILS: fails });
    const { stderr, exitCode } = await runTestChanged(String(dir), [], flag, env);
    expect(stderr).toContain(`error: --changed: fatal: the stand-in for git does not run ${fails}\n`);
    expect(ranFiles(stderr, [...names, "new.test.ts"])).toEqual([]);
    expect(exitCode).toBe(1);
  });

  // Git prints one `../` for each directory between the cwd and the root. An
  // answer that no path buffer holds must not be joined to the cwd.
  test.skipIf(isWindows)("root that does not fit a path buffer is an error", async () => {
    using dir = tempDir("test-changed-long-root", fixture);
    initRepo(String(dir));
    appendFileSync(join(String(dir), "c.test.ts"), "// touched\n");

    const env = standInEnv(String(dir), {
      STAND_IN_ANSWERS: "rev-parse",
      STAND_IN_ANSWER: "../" + Buffer.alloc(MAX_PATH_BYTES, "d/").toString(),
    });
    const { stderr, exitCode } = await runTestChanged(String(dir), [], "--changed", env);
    expect(stderr).toContain("error: --changed: `git rev-parse --show-cdup` printed a path that is too long\n");
    expect(ranFiles(stderr, names)).toEqual([]);
    expect(exitCode).toBe(1);
  });

  // Git can list a path that is longer than any path the system opens: here a
  // file that is only in a commit. Windows path buffers hold any name git lists.
  test.skipIf(isWindows)("listed path that is too long to open is not a changed file", async () => {
    using dir = tempDir("test-changed-long-path", fixture);
    initRepo(String(dir));
    // The name alone is below the limit, so git lists it. Joined to the root it is above.
    const length = MAX_PATH_BYTES - 12;
    const directories = Math.floor(length / 101);
    const name =
      Array.from({ length: directories }, () => Buffer.alloc(100, "d").toString() + "/").join("") +
      Buffer.alloc(length - directories * 101, "f").toString();
    const blob = git(String(dir), "hash-object", "-w", "README.md").trim();
    git(String(dir), "update-index", "--add", "--cacheinfo", `100644,${blob},${name}`);
    git(String(dir), "commit", "-q", "-m", "long");
    expect(git(String(dir), "diff", "--name-only", "HEAD", "--")).toBe(name + "\n");
    appendFileSync(join(String(dir), "src", "other.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, names)).toEqual(["b.test.ts"]);
    expect(exitCode).toBe(0);
  });

  // A `--changed --watch` restart reads the paths that the watcher saw change
  // from a list, and does not ask git. Here there is no repository and no git,
  // so a run that asks git fails. A path can hold a line break.
  test.skipIf(isWindows).each([
    { paths: ["de\np.ts", "dep-b.ts"], ran: ["wa.test.ts", "wb.test.ts"] },
    { paths: ["dep-b.ts", "de\np.ts"], ran: ["wa.test.ts", "wb.test.ts"] },
    { paths: ["dep-b.ts", "deleted.ts", "de\np.ts"], ran: ["wa.test.ts", "wb.test.ts"] },
  ])("restart list %j selects the tests that import its paths", async ({ paths, ran }) => {
    using dir = tempDir("test-changed-restart-list", {
      "package.json": JSON.stringify({ name: "restart-list", type: "module" }),
      "de\np.ts": `export const value = 1;\n`,
      "dep-b.ts": `export const value = 1;\n`,
      "dep-c.ts": `export const value = 1;\n`,
      "wa.test.ts": passingTest("wa", "./de\np.ts"),
      "wb.test.ts": passingTest("wb", "./dep-b"),
      "wc.test.ts": passingTest("wc", "./dep-c"),
      "no-git/.keep": "",
    });
    const list = join(String(dir), "restart-list");
    writeFileSync(list, paths.map(path => join(String(dir), path) + "\0").join(""));

    const { stderr, exitCode } = await runTestChanged(String(dir), [], "--changed", {
      ...bunEnv,
      PATH: join(String(dir), "no-git"),
      BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE: list,
    });
    expect(ranFiles(stderr, ["wa.test.ts", "wb.test.ts", "wc.test.ts"])).toEqual(ran);
    expect(existsSync(list)).toBe(false);
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

  // The watcher hands the restarted process the paths it saw change. A path
  // can hold a line break.
  test("editing a dirty file with a line break in its name reruns only its test", async () => {
    using dir = tempDir("test-changed-watch-line-break", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "de\np.ts": `export const A = 1;\n`,
      "dep-b.ts": `export const B = 2;\n`,
      "wa.test.ts": `import { test, expect } from "bun:test";\nimport { A } from "./de\\np.ts";\ntest("wa", () => expect(A).toBe(1));\n`,
      "wb.test.ts": `import { test, expect } from "bun:test";\nimport { B } from "./dep-b";\ntest("wb", () => expect(B).toBe(2));\n`,
    });
    initRepo(String(dir));
    // Both dependencies are dirty, so a restart that asks git reruns both tests.
    appendFileSync(join(String(dir), "de\np.ts"), "// dirty\n");
    appendFileSync(join(String(dir), "dep-b.ts"), "// dirty\n");

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
    let seen = 0;

    /** The output of the next run, up to its summary line. */
    async function nextRun(): Promise<string> {
      const summary = /Ran \d+ tests? across \d+ files?\./g;
      while (true) {
        summary.lastIndex = seen;
        if (summary.test(buf)) {
          const run = buf.slice(seen, summary.lastIndex);
          seen = summary.lastIndex;
          return run;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream closed before the next run ended\n${buf}`);
        buf += decoder.decode(value, { stream: true });
      }
    }

    // Initial run: git lists both dependencies.
    expect(ranFiles(await nextRun(), ["wa.test.ts", "wb.test.ts"])).toEqual(["wa.test.ts", "wb.test.ts"]);

    appendFileSync(join(String(dir), "de\np.ts"), "// touched again\n");
    expect(ranFiles(await nextRun(), ["wa.test.ts", "wb.test.ts"])).toEqual(["wa.test.ts"]);

    proc.kill();
    reader.releaseLock();
  });

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
