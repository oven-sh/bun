import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir, tmpdirSync } from "harness";
import { appendFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// Each case spawns a full `bun test` process. The slowest case takes about a
// second under a debug ASAN build; leave room for loaded CI machines.
const TEST_TIMEOUT = isASAN || isDebug ? 30_000 : 10_000;
setDefaultTimeout(TEST_TIMEOUT);

// Keep git from reading the developer's global config and make commits
// deterministic across machines. Used both for the `git` helper below and
// for every spawned `bun test --changed` process, since that process
// itself shells out to git and would otherwise inherit the developer's
// excludes/config.
//
// GIT_CONFIG_GLOBAL must point at a real (empty) file: pointing at the
// null device works on most platforms, but git on some Windows builds
// rejects "NUL" with "unable to access 'NUL': Invalid argument".
//
// LC_ALL=C keeps git's messages in English: the error case below pins the
// git stderr that `bun test --changed` relays.
const emptyGitConfig = join(tmpdirSync(), "empty.gitconfig");
writeFileSync(emptyGitConfig, "");
const gitEnv = {
  ...bunEnv,
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: emptyGitConfig,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  // Same effect as `git config` in every repo, without a process per key.
  // commit.gpgsign: no signing. core.excludesFile: the global ignore file
  // defaults to ~/.config/git/ignore, which GIT_CONFIG_GLOBAL does not
  // redirect, and a `node_modules/` rule there would hide the fixture under
  // node_modules from `git add -A`. maintenance.auto: every `git commit`
  // otherwise spawns a `git maintenance run --auto` child, which on Windows
  // runs in the foreground.
  GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "core.excludesFile",
  GIT_CONFIG_VALUE_1: emptyGitConfig,
  GIT_CONFIG_KEY_2: "maintenance.auto",
  GIT_CONFIG_VALUE_2: "false",
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  await using proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: gitEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${stderr}`);
  }
  return stdout;
}

/** Make `cwd` a git repo whose single commit holds every file in it. */
async function initRepo(cwd: string) {
  // `--template=` skips the sample hooks: they are never run and would be
  // copied along with every repo below.
  await git(cwd, "init", "-q", "--template=");
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-q", "-m", "initial");
}

async function runTestChanged(
  cwd: string,
  args: string[] = ["--changed"],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd,
    env: gitEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** The parts of a `bun test --changed` run's stderr that the cases below pin:
 *  the `--changed:` status line, the test files that ran (their `<path>:`
 *  headers, sorted because the scanner's order depends on the filesystem),
 *  and the final `Ran ...` line. */
function summarize(stderr: string) {
  const lines = normalizeBunSnapshot(stderr).split("\n");
  return {
    // Fall back to the whole stderr so a crash shows up in the failure diff.
    status: lines.find(l => l.startsWith("--changed:")) ?? stderr,
    files: lines
      .filter(l => l.endsWith(".test.ts:"))
      .map(l => l.slice(0, -1))
      .sort(),
    ran: lines.find(l => l.startsWith("Ran ")),
  };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Every case uses its own git repo, so run them concurrently.
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

  // The fixture is committed once. Each case copies the repo (a few dozen
  // small files, .git included) instead of running init + add + commit,
  // which on Windows costs more than the `bun test` run itself.
  let base: ReturnType<typeof tempDir>;
  beforeAll(async () => {
    base = tempDir("test-changed-base", fixture);
    await initRepo(String(base));
  });
  afterAll(() => base[Symbol.dispose]());
  const repo = (name: string) => tempDir(name, String(base));

  test("no changes -> runs nothing and exits 0", async () => {
    using dir = repo("test-changed-none");

    const { stdout, stderr, exitCode } = await runTestChanged(String(dir));
    expect(normalizeBunSnapshot(stdout)).toBe("bun test <version> (<revision>)");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "--changed: no changed files, nothing to run

       0 pass
       0 fail
      Ran 0 tests across 0 files."
    `);
    expect(exitCode).toBe(0);
  });

  const edits: [name: string, touched: string[], selected: string[]][] = [
    ["direct change to a test file runs only that test", ["c.test.ts"], ["c.test.ts"]],
    ["change to a direct dependency selects the importing test", ["src/other.ts"], ["b.test.ts"]],
    // a.test.ts -> util.ts -> helper.ts: touching helper should select a.
    ["change to a transitive dependency selects the importing test", ["src/helper.ts"], ["a.test.ts"]],
    [
      "multiple changes select the union of affected tests",
      ["src/helper.ts", "src/other.ts"],
      ["a.test.ts", "b.test.ts"],
    ],
  ];
  test.each(edits)("%s", async (_name, touched, selected) => {
    using dir = repo("test-changed-edit");
    for (const file of touched) {
      appendFileSync(join(String(dir), file), "// touched\n");
    }

    const { stdout, stderr, exitCode } = await runTestChanged(String(dir));
    expect(normalizeBunSnapshot(stdout)).toBe("bun test <version> (<revision>)");
    expect(summarize(stderr)).toEqual({
      status: `--changed: ${plural(touched.length, "changed file")}, running ${selected.length}/3 test files`,
      files: selected,
      ran: `Ran ${plural(selected.length, "test")} across ${plural(selected.length, "file")}.`,
    });
    expect(exitCode).toBe(0);
  });

  test("change to a file no test imports runs nothing", async () => {
    using dir = repo("test-changed-unrelated");
    appendFileSync(join(String(dir), "README.md"), "more\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "--changed: 1 changed file, but no test files are affected

       0 pass
       0 fail
      Ran 0 tests across 0 files."
    `);
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
    await initRepo(String(dir));
    appendFileSync(join(String(dir), "shared.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 2/3 test files",
      files: ["one.test.ts", "two.test.ts"],
      ran: "Ran 2 tests across 2 files.",
    });
    expect(exitCode).toBe(0);
  });

  test("staged changes are picked up", async () => {
    using dir = repo("test-changed-staged");
    appendFileSync(join(String(dir), "src", "other.ts"), "// touched\n");
    await git(String(dir), "add", "-A");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 1/3 test files",
      files: ["b.test.ts"],
      ran: "Ran 1 test across 1 file.",
    });
    expect(exitCode).toBe(0);
  });

  test("untracked test file is picked up", async () => {
    using dir = repo("test-changed-untracked");
    writeFileSync(
      join(String(dir), "new.test.ts"),
      `import { test, expect } from "bun:test";\ntest("new", () => expect(1).toBe(1));\n`,
    );

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 1/4 test files",
      files: ["new.test.ts"],
      ran: "Ran 1 test across 1 file.",
    });
    expect(exitCode).toBe(0);
  });

  test("--changed=<ref> compares against a commit", async () => {
    using dir = repo("test-changed-ref");

    // Make a second commit that touches helper.ts.
    appendFileSync(join(String(dir), "src", "helper.ts"), "// v2\n");
    await git(String(dir), "commit", "-q", "-a", "-m", "v2");

    // Working tree is clean, so bare --changed should run nothing.
    {
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(summarize(stderr)).toEqual({
        status: "--changed: no changed files, nothing to run",
        files: [],
        ran: "Ran 0 tests across 0 files.",
      });
      expect(exitCode).toBe(0);
    }

    // Against HEAD~1, helper.ts changed -> a.test.ts is selected.
    const { stderr, exitCode } = await runTestChanged(String(dir), ["--changed=HEAD~1"]);
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 1/3 test files",
      files: ["a.test.ts"],
      ran: "Ran 1 test across 1 file.",
    });
    expect(exitCode).toBe(0);
  });

  test("--changed=<ref> includes untracked files", async () => {
    using dir = repo("test-changed-ref-untracked");

    // Two commits so HEAD~1 is valid; working tree is clean.
    appendFileSync(join(String(dir), "src", "helper.ts"), "// v2\n");
    await git(String(dir), "commit", "-q", "-a", "-m", "v2");

    // Create a brand-new untracked test file. It did not exist at
    // HEAD~1, so it is "changed since HEAD~1" even though
    // `git diff --name-only HEAD~1` never lists untracked files.
    writeFileSync(
      join(String(dir), "new.test.ts"),
      `import { test, expect } from "bun:test";\ntest("new", () => expect(1).toBe(1));\n`,
    );

    const { stderr, exitCode } = await runTestChanged(String(dir), ["--changed=HEAD~1"]);
    // a.test.ts (helper.ts changed between HEAD~1 and HEAD) and the
    // brand-new untracked file should both run.
    expect(summarize(stderr)).toEqual({
      status: "--changed: 2 changed files, running 2/4 test files",
      files: ["a.test.ts", "new.test.ts"],
      ran: "Ran 2 tests across 2 files.",
    });
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
    await initRepo(String(dir));
    appendFileSync(join(String(dir), "node_modules", "fake-pkg", "index.js"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    // node_modules are not entered by the module graph scan, so changing
    // a file there should not select pkg.test.ts.
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "--changed: 1 changed file, but no test files are affected

       0 pass
       0 fail
      Ran 0 tests across 0 files."
    `);
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
    await initRepo(String(dir));
    appendFileSync(join(String(dir), "app", "dep.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(join(String(dir), "app"));
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 1/2 test files",
      files: ["sub.test.ts"],
      ran: "Ran 1 test across 1 file.",
    });
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
    await initRepo(String(dir));
    writeFileSync(
      join(String(dir), "app", "brand-new.test.ts"),
      `import { test, expect } from "bun:test";\ntest("brand-new", () => expect(1).toBe(1));\n`,
    );

    const { stderr, exitCode } = await runTestChanged(join(String(dir), "app"));
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 1/2 test files",
      files: ["brand-new.test.ts"],
      ran: "Ran 1 test across 1 file.",
    });
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
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stdout)).toBe("bun test <version> (<revision>)");
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(
      `"error: --changed: fatal: not a git repository: '<dir>/no-such-git-dir'"`,
    );
    expect(exitCode).toBe(1);
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
    await initRepo(String(dir));
    appendFileSync(join(String(dir), "good.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 1/2 test files",
      files: ["good.test.ts"],
      ran: "Ran 1 test across 1 file.",
    });
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
    await initRepo(String(dir));
    appendFileSync(join(String(dir), "src", "adder.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(summarize(stderr)).toEqual({
      status: "--changed: 1 changed file, running 2/3 test files",
      files: ["tests/alias.test.ts", "tests/relative.test.ts"],
      ran: "Ran 2 tests across 2 files.",
    });
    expect(exitCode).toBe(0);
  });
});

/** Reads a watcher's stderr incrementally and splits it into runs, so a test
 *  awaits the end of a run instead of polling. */
function watchRuns(proc: Bun.Subprocess<"ignore", "ignore", "pipe">) {
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  const summary = /^Ran \d+ tests? across \d+ files?\. \[[\d.]+m?s\]\n/m;
  // Give up before bun's own test timeout would. In a concurrent group bun
  // does not kill a timed-out test's children, so a hung watcher would
  // outlive the test and the failure would show none of its output. A
  // rejection here runs the `await using` disposer that kills the child.
  const deadline = Date.now() + TEST_TIMEOUT * 0.8;
  let buf = "";
  let cursor = 0;
  return {
    /** Everything the next run prints, through its complete `Ran ...` line.
     *  Resolving on that line means the child is quiescent again (tests
     *  done, watcher seeded) before the caller touches the next file. */
    async next(): Promise<string> {
      const { promise: expired, reject: expire } = Promise.withResolvers<never>();
      const timer = setTimeout(
        () => expire(new Error(`the watcher printed no complete run before the deadline\n${buf}`)),
        deadline - Date.now(),
      );
      try {
        let match: RegExpExecArray | null;
        while (!(match = summary.exec(buf.slice(cursor)))) {
          const { value, done } = await Promise.race([reader.read(), expired]);
          if (done) throw new Error(`stream closed before the run finished\n${buf}`);
          buf += decoder.decode(value, { stream: true });
        }
        const end = cursor + match.index + match[0].length;
        const run = buf.slice(cursor, end);
        cursor = end;
        return run;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function spawnWatch(cwd: string) {
  return Bun.spawn({
    cmd: [bunExe(), "test", "--changed", "--watch", "--no-clear-screen"],
    cwd,
    env: gitEnv,
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });
}

// On Windows, `bun test --watch` runs as a parent watcher-manager that
// respawns a child process on change (rather than exec()-in-place), which
// makes this test's stderr-stream sync points racy there. The 15 cases
// above fully cover the --changed filtering logic on Windows; this case
// only verifies composition with --watch.
describe.concurrent.skipIf(isWindows)("bun test --changed --watch", () => {
  test("restarts and reruns only affected tests when a dependency changes", async () => {
    using dir = tempDir("test-changed-watch", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "dep-a.ts": `export const A = 1;\n`,
      "dep-b.ts": `export const B = 2;\n`,
      "wa.test.ts": `import { test, expect } from "bun:test";\nimport { A } from "./dep-a";\ntest("wa", () => expect(A).toBe(1));\n`,
      "wb.test.ts": `import { test, expect } from "bun:test";\nimport { B } from "./dep-b";\ntest("wb", () => expect(B).toBe(2));\n`,
    });
    await initRepo(String(dir));

    await using proc = spawnWatch(String(dir));
    const runs = watchRuns(proc);

    // Initial run: nothing changed.
    expect(normalizeBunSnapshot(await runs.next())).toMatchInlineSnapshot(`
      "--changed: no changed files, nothing to run

       0 pass
       0 fail
      Ran 0 tests across 0 files."
    `);

    // Touch dep-a.ts: watcher restarts, --changed now sees an uncommitted
    // change to dep-a.ts and should run only wa.test.ts.
    appendFileSync(join(String(dir), "dep-a.ts"), "// touched\n");
    expect(normalizeBunSnapshot(await runs.next())).toMatchInlineSnapshot(`
      "--changed: 1 changed file, running 1/2 test files

      wa.test.ts:
      (pass) wa

       1 pass
       0 fail
       1 expect() calls
      Ran 1 test across 1 file."
    `);

    // Touch dep-b.ts: dep-a is still uncommitted in git, but the watcher
    // only saw dep-b change this restart, so only wb.test.ts should run.
    appendFileSync(join(String(dir), "dep-b.ts"), "// touched\n");
    expect(normalizeBunSnapshot(await runs.next())).toMatchInlineSnapshot(`
      "--changed: 1 changed file, running 1/2 test files

      wb.test.ts:
      (pass) wb

       1 pass
       0 fail
       1 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  // Regression for: with two uncommitted test files, editing one of them
  // during --changed --watch should only re-run that one, not both.
  test("editing one of several dirty test files reruns only that one", async () => {
    using dir = tempDir("test-changed-watch-narrow", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "wa.test.ts": `import { test, expect } from "bun:test";\ntest("wa", () => expect(1).toBe(1));\n`,
      "wb.test.ts": `import { test, expect } from "bun:test";\ntest("wb", () => expect(2).toBe(2));\n`,
    });
    await initRepo(String(dir));
    // Make both test files dirty (uncommitted) before starting the watcher.
    appendFileSync(join(String(dir), "wa.test.ts"), "// dirty\n");
    appendFileSync(join(String(dir), "wb.test.ts"), "// dirty\n");

    await using proc = spawnWatch(String(dir));
    const runs = watchRuns(proc);

    // Initial run: git reports both test files changed, so both run.
    expect(summarize(await runs.next())).toEqual({
      status: "--changed: 2 changed files, running 2/2 test files",
      files: ["wa.test.ts", "wb.test.ts"],
      ran: "Ran 2 tests across 2 files.",
    });

    // Now edit only wa.test.ts. The watcher passes exactly that path to
    // the restarted process; wb.test.ts (though still dirty in git) is
    // not in its DAG, so it must not re-run.
    appendFileSync(join(String(dir), "wa.test.ts"), "// touched again\n");
    expect(normalizeBunSnapshot(await runs.next())).toMatchInlineSnapshot(`
      "--changed: 1 changed file, running 1/2 test files

      wa.test.ts:
      (pass) wa

       1 pass
       0 fail
       1 expect() calls
      Ran 1 test across 1 file."
    `);
  });

  test("trigger file path handed to restarted runs has a 128-bit random hex suffix", async () => {
    using dir = tempDir("test-changed-watch-trigger-name", {
      "package.json": JSON.stringify({ name: "watch", type: "module" }),
      "dep-a.ts": `export const A = 1;\n`,
      "wa.test.ts": `import { test, expect } from "bun:test";\nimport { A } from "./dep-a";\ntest("wa", () => { console.error("TRIGGER=" + JSON.stringify(process.env.BUN_INTERNAL_TEST_CHANGED_TRIGGER_FILE ?? null)); expect(A).toBe(1); });\n`,
    });
    await initRepo(String(dir));

    await using proc = spawnWatch(String(dir));
    const runs = watchRuns(proc);

    expect(summarize(await runs.next())).toEqual({
      status: "--changed: no changed files, nothing to run",
      files: [],
      ran: "Ran 0 tests across 0 files.",
    });

    appendFileSync(join(String(dir), "dep-a.ts"), "// touched\n");
    const run = await runs.next();
    const match = run.match(/^TRIGGER=(.*)$/m);
    expect(match).not.toBeNull();
    const triggerPath = JSON.parse(match![1]);
    expect(typeof triggerPath).toBe("string");
    expect(basename(triggerPath)).toMatch(/^\.bun-test-changed-[0-9a-f]{32}\.trigger$/);
    expect(normalizeBunSnapshot(run.replace(match![0], "TRIGGER=<path>"))).toMatchInlineSnapshot(`
      "--changed: 1 changed file, running 1/1 test file

      wa.test.ts:
      TRIGGER=<path>
      (pass) wa

       1 pass
       0 fail
       1 expect() calls
      Ran 1 test across 1 file."
    `);
  });
});
