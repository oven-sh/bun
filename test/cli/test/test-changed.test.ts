import { spawnSync } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir, tmpdirSync } from "harness";
import { appendFileSync, writeFileSync } from "node:fs";
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

/** The `--changed:` lines of a run, in the order it printed them. */
function changedLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter(line => line.startsWith("--changed:"));
}

/** The line for a file that the module graph scan could not read, parse or resolve. */
function couldNotScan(file: string, error: string): string {
  return `--changed: could not scan "${file}", so it counts as changed: ${error}`;
}

// price.test.ts -> price.ts -> rates.ts. "Cannot assign to import" is an error
// only in a bundle: the module graph scan refuses price.ts, the runtime loads it.
const refusedFixture = {
  "package.json": JSON.stringify({ name: "changed-refused", type: "module" }),
  "rates.ts": `export const rate = 1;\n`,
  "price.ts": `import { rate } from "./rates";\nexport const price = rate * 2;\nexport function never() {\n  rate = 0;\n}\n`,
  "price.test.ts": `import { test, expect } from "bun:test";\nimport { price } from "./price";\ntest("price", () => expect(price).toBe(2));\n`,
  "other.ts": `export const other = 9;\n`,
  "other.test.ts": `import { test, expect } from "bun:test";\nimport { other } from "./other";\ntest("other", () => expect(other).toBe(9));\n`,
  "README.md": "hello\n",
};
const refusedNames = ["other.test.ts", "price.test.ts"];
const priceRefused = couldNotScan("price.ts", `Cannot assign to import "rate"`);

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

  // What a file imports is unknown when the scan cannot parse it, so a changed
  // file can be behind it: every test file that reaches it runs.
  test.each([
    {
      // Plain `bun test` fails here: rates.ts is behind price.ts.
      title: "an edit of a file that it imports",
      edit: { "rates.ts": `export const rate = 2;\n` },
      lines: [priceRefused, "--changed: 1 changed file, running 1/2 test files"],
      ran: ["price.test.ts"],
      exitCode: 1,
    },
    {
      title: "an edit of a file that nothing imports",
      edit: { "README.md": "more\n" },
      lines: [priceRefused, "--changed: 1 changed file, running 1/2 test files"],
      ran: ["price.test.ts"],
      exitCode: 0,
    },
    {
      title: "an edit of a file that another test imports",
      edit: { "other.ts": `export const other = 9; // touched\n` },
      lines: [priceRefused, "--changed: 1 changed file, running 2/2 test files"],
      ran: ["other.test.ts", "price.test.ts"],
      exitCode: 0,
    },
    {
      // A changed file selects its importers already: there is nothing to say.
      title: "an edit of the file itself",
      edit: { "price.ts": refusedFixture["price.ts"] + "// touched\n" },
      lines: ["--changed: 1 changed file, running 1/2 test files"],
      ran: ["price.test.ts"],
      exitCode: 0,
    },
    {
      // A clean tree has no scan.
      title: "no edit",
      edit: {},
      lines: ["--changed: no changed files, nothing to run"],
      ran: [],
      exitCode: 0,
    },
  ])("a file that the scan refuses counts as changed: $title", async ({ edit, lines, ran, exitCode }) => {
    using dir = tempDir("test-changed-refused", refusedFixture);
    initRepo(String(dir));
    for (const [name, contents] of Object.entries(edit)) writeFileSync(join(String(dir), name), contents);

    const result = await runTestChanged(String(dir));
    expect({
      lines: changedLines(result.stderr),
      ran: ranFiles(result.stderr, refusedNames),
      exitCode: result.exitCode,
    }).toEqual({ lines, ran, exitCode });
  });

  // The bundler's parser refuses this top-level `return`, the runtime accepts it.
  // The assertions hold whether the scan can parse price.js or not.
  test("an edit behind a CommonJS file with a top-level return selects its test", async () => {
    using dir = tempDir("test-changed-top-level-return", {
      "rates.js": `exports.rate = 1;\n`,
      "price.js": `exports.rate = require("./rates.js").rate;\nif (process.env.NO_EXTRAS) return;\nexports.extras = true;\n`,
      "price.test.js": `import { test, expect } from "bun:test";\nimport price from "./price.js";\ntest("the rate", () => {\n  expect(price.rate).toBe(1);\n});\n`,
    });
    initRepo(String(dir));
    writeFileSync(join(String(dir), "rates.js"), `exports.rate = 2;\n`);

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ ran: ranFiles(stderr, ["price.test.js"]), exitCode }).toEqual({ ran: ["price.test.js"], exitCode: 1 });
    expect(stderr).toMatch(/Expected: 1\r?\nReceived: 2/);
  });

  test("a file with a syntax error counts as changed, and the run reports the error", async () => {
    using dir = tempDir("test-changed-syntax-error", {
      ...refusedFixture,
      "price.ts": `import { rate } from "./rates";\nexport const price = rate * 2;\nconst broken = ;\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "rates.ts"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ lines: changedLines(stderr), ran: ranFiles(stderr, refusedNames), exitCode }).toEqual({
      lines: [couldNotScan("price.ts", "Unexpected ;"), "--changed: 1 changed file, running 1/2 test files"],
      ran: ["price.test.ts"],
      exitCode: 1,
    });
    expect(stderr).toContain("error: Unexpected ;");
  });

  test("a file that only a preload plugin can load counts as changed", async () => {
    using dir = tempDir("test-changed-plugin", {
      "package.json": JSON.stringify({ name: "changed-plugin", type: "module" }),
      "bunfig.toml": `[test]\npreload = ["./plugin.ts"]\n`,
      "plugin.ts": `import { plugin } from "bun";
plugin({
  name: "tpl",
  setup(build) {
    build.onLoad({ filter: /\\.tpl\\.js$/ }, async args => {
      const [, name, from] = /^IMPORT (\\w+) FROM (\\S+)/.exec(await Bun.file(args.path).text())!;
      return { contents: "export { " + name + " } from " + JSON.stringify(from) + ";", loader: "js" };
    });
  },
});
`,
      "rates.js": `export const rate = 1;\n`,
      "price.tpl.js": `IMPORT rate FROM ./rates.js\n`,
      "price.test.js": `import { test, expect } from "bun:test";\nimport { rate } from "./price.tpl.js";\ntest("rate", () => expect(rate).toBe(1));\n`,
    });
    initRepo(String(dir));
    writeFileSync(join(String(dir), "rates.js"), `export const rate = 2;\n`);

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ lines: changedLines(stderr), ran: ranFiles(stderr, ["price.test.js"]), exitCode }).toEqual({
      lines: [
        couldNotScan("price.tpl.js", `Expected ";" but found "rate"`),
        "--changed: 1 changed file, running 1/1 test file",
      ],
      ran: ["price.test.js"],
      exitCode: 1,
    });
  });

  test("a test file that the scan refuses counts as changed", async () => {
    using dir = tempDir("test-changed-refused-test-file", {
      "package.json": JSON.stringify({ name: "changed-refused-test-file", type: "module" }),
      "rates.ts": `export const rate = 1;\n`,
      "price.test.ts": `import { test, expect } from "bun:test";\nimport { rate } from "./rates";\ntest("rate", () => expect(rate).toBe(1));\nexport function never() {\n  rate = 0;\n}\n`,
      "other.test.ts": `import { test, expect } from "bun:test";\ntest("other", () => expect(1).toBe(1));\n`,
    });
    initRepo(String(dir));
    writeFileSync(join(String(dir), "rates.ts"), `export const rate = 2;\n`);

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ lines: changedLines(stderr), ran: ranFiles(stderr, refusedNames), exitCode }).toEqual({
      lines: [
        couldNotScan("price.test.ts", `Cannot assign to import "rate"`),
        "--changed: 1 changed file, running 1/2 test files",
      ],
      ran: ["price.test.ts"],
      exitCode: 1,
    });
  });

  test("a data file that does not parse counts as changed", async () => {
    using dir = tempDir("test-changed-data-file", {
      "package.json": JSON.stringify({ name: "changed-data-file", type: "module" }),
      "data.json": `{ "rate": 1, oops }\n`,
      "data.test.ts": `import { test, expect } from "bun:test";\ntest("data", () => expect(import("./data.json")).rejects.toThrow("JSON Parse error"));\n`,
      "other.test.ts": `import { test, expect } from "bun:test";\ntest("other", () => expect(1).toBe(1));\n`,
      "README.md": "hello\n",
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "README.md"), "more\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({
      lines: changedLines(stderr),
      ran: ranFiles(stderr, ["data.test.ts", "other.test.ts"]),
      exitCode,
    }).toEqual({
      lines: [
        couldNotScan("data.json", `Expected string but found "oops"`),
        "--changed: 1 changed file, running 1/2 test files",
      ],
      ran: ["data.test.ts"],
      exitCode: 0,
    });
  });

  // The runtime imports a stylesheet as `{}`. It reads neither the stylesheet
  // nor the files the stylesheet imports.
  test("a stylesheet that the scan refuses does not count as changed", async () => {
    using dir = tempDir("test-changed-stylesheet", {
      "package.json": JSON.stringify({ name: "changed-stylesheet", type: "module" }),
      "app.css": `.app { color: red; *zoom: 1 }\n`,
      "app.ts": `import "./app.css";\nexport const app = 1;\n`,
      "app.test.ts": `import { test, expect } from "bun:test";\nimport { app } from "./app";\ntest("app", () => expect(app).toBe(1));\n`,
      "README.md": "hello\n",
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "README.md"), "more\n");

    // The bundler's CSS parser refuses the stylesheet.
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "./app.css", "--outdir", "out"],
      cwd: String(dir),
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).toContain("error: Unexpected end of input");
    expect(buildExitCode).toBe(1);

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ lines: changedLines(stderr), ran: ranFiles(stderr, ["app.test.ts"]), exitCode }).toEqual({
      lines: ["--changed: 1 changed file, but no test files are affected"],
      ran: [],
      exitCode: 0,
    });
  });

  // MAX_FAILED_FILES_SHOWN in ChangedFilesFilter.rs is 5.
  test.each([5, 6])("%d files that the scan refuses are named in path order, five at most", async count => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "changed-refused-many", type: "module" }),
      "rates.ts": `export const rate = 1;\n`,
      "README.md": "hello\n",
    };
    let imports = "";
    for (let i = 1; i <= count; i++) {
      files[`m${i}.ts`] =
        `import { rate } from "./rates";\nexport const m${i} = rate;\nexport function never() {\n  rate = 0;\n}\n`;
      imports += `import "./m${i}";\n`;
    }
    files["many.test.ts"] =
      `import { test, expect } from "bun:test";\n${imports}test("many", () => expect(1).toBe(1));\n`;
    using dir = tempDir("test-changed-refused-many", files);
    initRepo(String(dir));
    appendFileSync(join(String(dir), "README.md"), "more\n");

    const lines = [1, 2, 3, 4, 5].map(i => couldNotScan(`m${i}.ts`, `Cannot assign to import "rate"`));
    if (count > 5) lines.push(`--changed: and ${count - 5} more that could not be scanned`);
    lines.push("--changed: 1 changed file, running 1/1 test file");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ lines: changedLines(stderr), ran: ranFiles(stderr, ["many.test.ts"]), exitCode }).toEqual({
      lines,
      ran: ["many.test.ts"],
      exitCode: 0,
    });
  });

  // The scan holds price.js two times: for the test (target bun) and for the
  // page (target browser). Both rows are failed rows.
  test("a file that the scan refuses for two targets is named one time", async () => {
    using dir = tempDir("test-changed-refused-two-targets", {
      "package.json": JSON.stringify({ name: "changed-refused-two-targets", type: "module" }),
      "rates.js": `export const rate = 1;\n`,
      "price.js": `import { rate } from "./rates.js";\nexport const price = rate * 2;\nexport function never() {\n  rate = 0;\n}\n`,
      "page.html": `<!doctype html><html><body><script type="module" src="./price.js"></script></body></html>\n`,
      "price.test.js": `import { test, expect } from "bun:test";\nimport page from "./page.html";\nimport { price } from "./price.js";\ntest("price", () => {\n  expect(page).toBeDefined();\n  expect(price).toBe(2);\n});\n`,
    });
    initRepo(String(dir));
    writeFileSync(join(String(dir), "rates.js"), `export const rate = 2;\n`);

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ lines: changedLines(stderr), ran: ranFiles(stderr, ["price.test.js"]), exitCode }).toEqual({
      lines: [
        couldNotScan("price.js", `Cannot assign to import "rate"`),
        "--changed: 1 changed file, running 1/1 test file",
      ],
      ran: ["price.test.js"],
      exitCode: 1,
    });
  });

  // The scanner lists `a\b.test.js` as `a/b.test.js`, a path that does not
  // exist. The module graph scan cannot resolve that entry point, and the run
  // cannot load it: plain `bun test` exits with code 1.
  test.skipIf(isWindows)("a test file that the scan cannot resolve counts as changed", async () => {
    using dir = tempDir("test-changed-unresolved-entry", {
      "package.json": JSON.stringify({ name: "changed-unresolved-entry", type: "module" }),
      "rates.js": `export const rate = 1;\n`,
      "a\\b.test.js": `import { test, expect } from "bun:test";\nimport { rate } from "./rates.js";\ntest("odd", () => expect(rate).toBe(1));\n`,
      "plain.test.js": `import { test, expect } from "bun:test";\nimport { rate } from "./rates.js";\ntest("plain", () => expect(rate).toBe(1));\n`,
    });
    initRepo(String(dir));
    appendFileSync(join(String(dir), "rates.js"), "// touched\n");

    const { stderr, exitCode } = await runTestChanged(String(dir));
    expect({ lines: changedLines(stderr), exitCode }).toEqual({
      lines: [
        `--changed: could not scan "a/b.test.js", so it counts as changed`,
        "--changed: 1 changed file, running 2/2 test files",
      ],
      exitCode: 1,
    });
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

  // The scan cannot list what price.ts imports, so it cannot watch rates.ts.
  // The first run loads price.test.ts, and the module loader watches rates.ts.
  test("runs the tests that reach a file the scan refuses, then reruns them when a file behind it changes", async () => {
    using dir = tempDir("test-changed-watch-refused", refusedFixture);
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

    // Sync on the end-of-run summary ("Ran N tests across M files.").
    await waitFor(" across ");
    expect({ lines: changedLines(buf), ran: ranFiles(buf, refusedNames) }).toEqual({
      lines: [priceRefused, "--changed: 0 changed files, running 1/2 test files"],
      ran: ["price.test.ts"],
    });

    const before = buf.length;
    appendFileSync(join(String(dir), "rates.ts"), "// touched\n");
    await waitFor(" across ", before);
    const after = buf.slice(before);
    expect({ lines: changedLines(after), ran: ranFiles(after, refusedNames) }).toEqual({
      lines: [priceRefused, "--changed: 1 changed file, running 1/2 test files"],
      ran: ["price.test.ts"],
    });

    proc.kill();
    reader.releaseLock();
  }, 60_000);
});
