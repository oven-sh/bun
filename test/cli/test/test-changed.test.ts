import { spawnSync } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir, tmpdirSync } from "harness";
import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", flag, ...extra],
    cwd,
    env: gitEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

/** A link at `link` to the directory `target`: what `bun install` creates for a
 *  workspace dependency and for a package of an isolated install. A junction
 *  on Windows, which needs no privilege. */
function linkDirectory(target: string, link: string) {
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, "junction");
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

  // A bare specifier can name a local file. Only a package that is installed
  // under node_modules is not followed.
  const importsOne = (specifier: string) =>
    `import { test, expect } from "bun:test";\nimport { one } from "${specifier}";\ntest("a", () => expect(one).toBe(1));\n`;
  const unrelated = `import { test, expect } from "bun:test";\ntest("other", () => expect(1).toBe(1));\n`;
  test.each([
    [
      "package.json imports",
      {
        "package.json": JSON.stringify({ name: "p", type: "module", imports: { "#util": "./src/util.ts" } }),
        "src/util.ts": `export const one = 1;\n`,
        "a.test.ts": importsOne("#util"),
      },
      ["src", "util.ts"],
      undefined,
    ],
    [
      "the package's own name",
      {
        "package.json": JSON.stringify({ name: "self", type: "module", exports: { ".": "./src/util.ts" } }),
        "src/util.ts": `export const one = 1;\n`,
        "a.test.ts": importsOne("self"),
      },
      ["src", "util.ts"],
      undefined,
    ],
    [
      "tsconfig baseUrl",
      {
        "package.json": JSON.stringify({ name: "p", type: "module" }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "." } }),
        "src/util.ts": `export const one = 1;\n`,
        "a.test.ts": importsOne("src/util"),
      },
      ["src", "util.ts"],
      undefined,
    ],
    [
      "a workspace package",
      {
        "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
        "packages/lib/package.json": JSON.stringify({ name: "lib", type: "module", main: "index.ts" }),
        "packages/lib/index.ts": `export const one = 1;\n`,
        "packages/app/package.json": JSON.stringify({ name: "app", dependencies: { lib: "workspace:*" } }),
        "packages/app/a.test.ts": importsOne("lib"),
      },
      ["packages", "lib", "index.ts"],
      [
        ["packages", "lib"],
        ["node_modules", "lib"],
      ],
    ],
    [
      // git names the file under the real directory.
      "a tsconfig paths alias through a linked directory",
      {
        "package.json": JSON.stringify({ name: "p", type: "module" }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@shared/*": ["./linked/*"] } } }),
        "shared/util.ts": `export const one = 1;\n`,
        "a.test.ts": importsOne("@shared/util"),
      },
      ["shared", "util.ts"],
      [["shared"], ["linked"]],
    ],
  ] as const)(
    "a change behind a bare specifier selects the importing test (%s)",
    async (_label, files, edited, link) => {
      using dir = tempDir("test-changed-bare", {
        ...files,
        "other.test.ts": unrelated,
        ".gitignore": "node_modules\nlinked\n",
      });
      if (link) linkDirectory(join(String(dir), ...link[0]), join(String(dir), ...link[1]));
      initRepo(String(dir));
      writeFileSync(join(String(dir), ...edited), `export const one = 2;\n`);

      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, ["a.test.ts", "other.test.ts"])).toEqual(["a.test.ts"]);
      expect(exitCode).toBe(1);
    },
  );

  // https://github.com/oven-sh/bun/issues/44162
  test("package.json imports and a workspace package's exports are followed from a package directory", async () => {
    const testFile = (name: string, specifier: string, fn: string, value: number) =>
      `import { expect, test } from "bun:test";\nimport { ${fn} } from "${specifier}";\ntest("${name}", () => expect(${fn}()).toBe(${value}));\n`;
    using dir = tempDir("test-changed-44162", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      ".gitignore": "node_modules\n",
      "packages/lib/package.json": JSON.stringify({
        name: "@repro/lib",
        type: "module",
        exports: { "./*": "./src/*.ts" },
      }),
      "packages/lib/src/lib.ts": `export const lib = () => 1;\n`,
      "packages/app/package.json": JSON.stringify({
        name: "@repro/app",
        type: "module",
        imports: { "#src/*": "./src/*" },
        dependencies: { "@repro/lib": "workspace:*" },
      }),
      "packages/app/src/own.ts": `export const own = () => 2;\n`,
      "packages/app/src/relative.test.ts": testFile("relative import", "./own.ts", "own", 2),
      "packages/app/src/subpath.test.ts": testFile("package.json imports", "#src/own.ts", "own", 2),
      "packages/app/src/workspace.test.ts": testFile("workspace package", "@repro/lib/lib", "lib", 1),
    });
    const app = join(String(dir), "packages", "app");
    // The isolated linker puts the link in the dependent package.
    linkDirectory(join(String(dir), "packages", "lib"), join(app, "node_modules", "@repro", "lib"));
    initRepo(String(dir));
    const testNames = ["relative.test.ts", "subpath.test.ts", "workspace.test.ts"];

    appendFileSync(join(app, "src", "own.ts"), "// change\n");
    {
      const { stderr, exitCode } = await runTestChanged(app);
      expect(ranFiles(stderr, testNames)).toEqual(["relative.test.ts", "subpath.test.ts"]);
      expect(exitCode).toBe(0);
    }

    git(String(dir), "checkout", "-q", "--", "packages/app/src/own.ts");
    appendFileSync(join(String(dir), "packages", "lib", "src", "lib.ts"), "// change\n");
    {
      const { stderr, exitCode } = await runTestChanged(app);
      expect(ranFiles(stderr, testNames)).toEqual(["workspace.test.ts"]);
      expect(exitCode).toBe(0);
    }

    git(String(dir), "commit", "-q", "-a", "-m", "change lib");
    {
      const { stderr, exitCode } = await runTestChanged(app, [], "--changed=HEAD~1");
      expect(ranFiles(stderr, testNames)).toEqual(["workspace.test.ts"]);
      expect(exitCode).toBe(0);
    }
  });

  // The scan must follow an import to the file that the run loads.
  test("an import resolves to the file that the test run loads", async () => {
    using dir = tempDir("test-changed-like-the-run", {
      "package.json": JSON.stringify({ name: "root", private: true, type: "module", workspaces: ["packages/*"] }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { vitest: ["./vitest-shim.ts"] } } }),
      ".gitignore": "node_modules\n",
      // The "bun" condition, not "browser" and not "default".
      "packages/lib/package.json": JSON.stringify({
        name: "lib",
        type: "module",
        exports: { ".": { bun: "./bun.ts", browser: "./browser.ts", default: "./default.ts" } },
      }),
      "packages/lib/bun.ts": `export const one = 1;\n`,
      "packages/lib/browser.ts": `export const one = 2;\n`,
      "packages/lib/default.ts": `export const one = 3;\n`,
      // "main", not "browser".
      "shim/package.json": JSON.stringify({ name: "shim", type: "module", main: "./main.js", browser: "./browser.js" }),
      "shim/main.js": `export const one = 1;\n`,
      "shim/browser.js": `export const one = 2;\n`,
      // "main", not "module".
      "dual/package.json": JSON.stringify({ name: "dual", type: "module", main: "./main.js", module: "./module.js" }),
      "dual/main.js": `export const one = 1;\n`,
      "dual/module.js": `export const one = 2;\n`,
      // `bun test` turns "vitest" into "bun:test" before it looks at an alias.
      "vitest-shim.ts": `throw new Error("the test run does not load this file");\n`,
      // `process.env` is read when the code runs, so this branch is live in the test.
      "env.cjs": `module.exports.load = () => {\n  if (process.env.NODE_ENV === "production") return require("./production.cjs").one;\n  return 0;\n};\n`,
      "production.cjs": `module.exports.one = 1;\n`,
      "exports.test.ts": importsOne("lib"),
      "browser.test.ts": importsOne("./shim"),
      "module.test.ts": importsOne("./dual"),
      "vitest.test.ts": `import { test, expect } from "vitest";\ntest("a", () => expect(1).toBe(1));\n`,
      "env.test.ts": `import { test, expect } from "bun:test";\nimport { load } from "./env.cjs";\ntest("a", () => {\n  process.env.NODE_ENV = "production";\n  expect(load()).toBe(1);\n});\n`,
    });
    linkDirectory(join(String(dir), "packages", "lib"), join(String(dir), "node_modules", "lib"));
    initRepo(String(dir));
    const testNames = ["browser.test.ts", "env.test.ts", "exports.test.ts", "module.test.ts", "vitest.test.ts"];
    const touch = (...files: string[]) => {
      for (const file of files) appendFileSync(join(String(dir), file), "// touched\n");
    };

    touch("packages/lib/browser.ts", "packages/lib/default.ts", "shim/browser.js", "dual/module.js", "vitest-shim.ts");
    {
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, testNames)).toEqual([]);
      expect(stderr).toContain("5 changed files, but no test files are affected");
      expect(exitCode).toBe(0);
    }

    git(String(dir), "checkout", "-q", "--", ".");
    touch("packages/lib/bun.ts", "shim/main.js", "dual/main.js", "production.cjs");
    {
      const { stderr, exitCode } = await runTestChanged(String(dir));
      // Each test passes only with the value of the file that was edited.
      expect(ranFiles(stderr, testNames)).toEqual([
        "browser.test.ts",
        "env.test.ts",
        "exports.test.ts",
        "module.test.ts",
      ]);
      expect(stderr).toContain(" 4 pass");
      expect(exitCode).toBe(0);
    }
  });

  // The scan looks for a file before a preload creates it. The run must not
  // inherit that answer.
  test("a file that a preload generates resolves in the test run", async () => {
    using dir = tempDir("test-changed-generated", {
      "package.json": JSON.stringify({ name: "p", type: "module", imports: { "#gen/*": "./gen/*.ts" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@gen/*": ["./gen/*"] } } }),
      "bunfig.toml": `[test]\npreload = ["./setup.ts"]\n`,
      ".gitignore": "gen\n",
      "setup.ts": `import { mkdirSync, writeFileSync } from "node:fs";\nimport { join } from "node:path";\nmkdirSync(join(import.meta.dir, "gen"), { recursive: true });\nwriteFileSync(join(import.meta.dir, "gen", "x.ts"), "export const one = 1;\\n");\n`,
      "imports.test.ts": importsOne("#gen/x"),
      "paths.test.ts": importsOne("@gen/x"),
    });
    initRepo(String(dir));
    const testNames = ["imports.test.ts", "paths.test.ts"];
    for (const name of testNames) appendFileSync(join(String(dir), name), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect(ranFiles(stderr, testNames)).toEqual(testNames);
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  });

  test("an installed package is not followed, however it is imported", async () => {
    const installed = (directory: string, name: string) => ({
      [`${directory}/package.json`]: JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
      [`${directory}/index.js`]: `module.exports = { one: 1 };\n`,
    });
    const store = "node_modules/.bun/linked@1.0.0/node_modules/linked";
    // node_modules is committed here, so git reports a change in it.
    using dir = tempDir("test-changed-installed", {
      "package.json": JSON.stringify({
        name: "p",
        type: "module",
        imports: { "#util": "./src/util.ts", "#dep": "dep" },
      }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "." } }),
      "src/util.ts": `export const one = 1;\n`,
      // A hoisted install is a directory.
      ...installed("node_modules/dep", "dep"),
      // An isolated install is a link into a store that is under node_modules too.
      ...installed(store, "linked"),
      // A file in node_modules itself.
      "node_modules/single.js": `module.exports = { one: 1 };\n`,
      "local.test.ts": importsOne("#util"),
      "plain.test.ts": importsOne("dep"),
      "alias.test.ts": importsOne("#dep"),
      "linked.test.ts": importsOne("linked"),
      "single.test.ts": importsOne("single"),
      // The script of a page resolves for the browser, in a transpiler of its own.
      "page.html": `<!doctype html><html><body><script type="module" src="./client.ts"></script></body></html>\n`,
      "client.ts": `import { one } from "dep";\nconsole.log(one);\n`,
      "page.test.ts": `import { test, expect } from "bun:test";\nimport page from "./page.html";\ntest("a", () => expect(page).toBeDefined());\n`,
    });
    linkDirectory(join(String(dir), store), join(String(dir), "node_modules", "linked"));
    initRepo(String(dir));
    const testNames = [
      "alias.test.ts",
      "linked.test.ts",
      "local.test.ts",
      "page.test.ts",
      "plain.test.ts",
      "single.test.ts",
    ];

    writeFileSync(join(String(dir), "src", "util.ts"), `export const one = 2;\n`);
    {
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, testNames)).toEqual(["local.test.ts"]);
      expect(exitCode).toBe(1);
    }

    git(String(dir), "checkout", "-q", "--", ".");
    appendFileSync(join(String(dir), "node_modules", "dep", "index.js"), "// touched\n");
    appendFileSync(join(String(dir), store, "index.js"), "// touched\n");
    appendFileSync(join(String(dir), "node_modules", "single.js"), "// touched\n");
    {
      const { stderr, exitCode } = await runTestChanged(String(dir));
      expect(ranFiles(stderr, testNames)).toEqual([]);
      expect(stderr).toContain("3 changed files, but no test files are affected");
      expect(exitCode).toBe(0);
    }
  });

  // git names a file by its real path, so the scan resolves to the real path
  // also when the run keeps the path of the link.
  test("--preserve-symlinks: a change behind a link selects the importing test", async () => {
    using dir = tempDir("test-changed-preserve-symlinks", {
      "package.json": JSON.stringify({ name: "root", private: true, type: "module", workspaces: ["packages/*"] }),
      ".gitignore": "node_modules\nlinked\n",
      "shared/x.ts": `export const one = 1;\n`,
      "packages/lib/package.json": JSON.stringify({ name: "lib", type: "module", main: "index.ts" }),
      "packages/lib/index.ts": `export const one = 1;\n`,
      "directory.test.ts": importsOne("./linked/x"),
      "package.test.ts": importsOne("lib"),
      "other.test.ts": unrelated,
    });
    linkDirectory(join(String(dir), "shared"), join(String(dir), "linked"));
    linkDirectory(join(String(dir), "packages", "lib"), join(String(dir), "node_modules", "lib"));
    initRepo(String(dir));
    appendFileSync(join(String(dir), "shared", "x.ts"), "// touched\n");
    appendFileSync(join(String(dir), "packages", "lib", "index.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir), ["--preserve-symlinks"]);
    const testNames = ["directory.test.ts", "other.test.ts", "package.test.ts"];
    expect(ranFiles(stderr, testNames)).toEqual(["directory.test.ts", "package.test.ts"]);
    expect(stderr).toContain(" 2 pass");
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

  // A file behind a bare specifier is part of the module graph, so the
  // watcher is seeded with it.
  test("editing a workspace package file reruns only the test that imports it", async () => {
    using dir = tempDir("test-changed-watch-workspace", {
      "package.json": JSON.stringify({ name: "root", private: true, type: "module", workspaces: ["packages/*"] }),
      ".gitignore": "node_modules\n",
      "packages/lib/package.json": JSON.stringify({ name: "lib", type: "module", main: "index.ts" }),
      "packages/lib/index.ts": `export const A = 1;\n`,
      "dep-b.ts": `export const B = 2;\n`,
      "wa.test.ts": `import { test, expect } from "bun:test";\nimport { A } from "lib";\ntest("wa", () => expect(A).toBe(1));\n`,
      "wb.test.ts": `import { test, expect } from "bun:test";\nimport { B } from "./dep-b";\ntest("wb", () => expect(B).toBe(2));\n`,
    });
    linkDirectory(join(String(dir), "packages", "lib"), join(String(dir), "node_modules", "lib"));
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
    appendFileSync(join(String(dir), "packages", "lib", "index.ts"), "// touched\n");
    await waitFor("Ran 1 test across 1 file", before);
    expect(ranFiles(buf.slice(before), ["wa.test.ts", "wb.test.ts"])).toEqual(["wa.test.ts"]);

    proc.kill();
    reader.releaseLock();
  });

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
