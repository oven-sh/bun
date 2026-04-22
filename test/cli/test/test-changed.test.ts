import { spawnSync } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Each case spawns a full `bun test` process; give the concurrent group
// headroom on slow ASAN/CI machines.
setDefaultTimeout(30_000);

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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--changed", ...extra],
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

  // Regression for https://github.com/oven-sh/bun/issues/29590: a test that
  // reaches a shared source file via a tsconfig `paths` alias whose key
  // looks bare (e.g. "@/*") must still be selected when that source file
  // changes. The scan bundler runs with packages=external so bare
  // specifiers aren't followed into node_modules; the path-alias key
  // must not be mistaken for one of those bare specifiers.
  test("tsconfig paths alias is followed when computing the module graph", async () => {
    using dir = tempDir("test-changed-tsconfig-paths", {
      "package.json": JSON.stringify({ name: "aliasrepro", type: "module" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
      }),
      "src/adder.ts": `export const add = (a: number, b: number) => a + b;\n`,
      "tests/alias.test.ts":
        `import { test, expect } from "bun:test";\n` +
        `import { add } from "@/src/adder";\n` +
        `test("alias", () => expect(add(1, 2)).toBe(3));\n`,
      "tests/relative.test.ts":
        `import { test, expect } from "bun:test";\n` +
        `import { add } from "../src/adder";\n` +
        `test("relative", () => expect(add(1, 2)).toBe(3));\n`,
      "tests/unrelated.test.ts":
        `import { test, expect } from "bun:test";\n` +
        `test("unrelated", () => expect(1).toBe(1));\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "src", "adder.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    const testNames = ["alias.test.ts", "relative.test.ts", "unrelated.test.ts"];
    // Both importers of src/adder.ts are selected — the aliased one must
    // not be silently dropped. The unrelated test stays filtered out.
    expect(ranFiles(stderr, testNames)).toEqual(["alias.test.ts", "relative.test.ts"]);
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
});
