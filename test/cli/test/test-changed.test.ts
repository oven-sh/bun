import { spawnSync } from "bun";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir, tempDirWithFiles, tmpdirSync } from "harness";
import { appendFileSync, existsSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

type Fixture = Record<string, string | Buffer>;

/** A test file with one test. `imports` is what comes before the test, `body` is in it. */
function testFile(name: string, imports = "", body = "expect(1).toBe(1);") {
  return `import { expect, test } from "bun:test";\n${imports}\ntest(${JSON.stringify(name)}, async () => {\n  ${body}\n});\n`;
}

// One committed repository per fixture. Each case edits a copy of it.
const committed = new Map<Fixture, string>();
function committedRepo(files: Fixture): string {
  let repo = committed.get(files);
  if (repo === undefined) {
    repo = tempDirWithFiles("test-changed-fixture", files);
    initRepo(repo);
    committed.set(files, repo);
  }
  return repo;
}
afterAll(() => {
  for (const repo of committed.values()) rmSync(repo, { recursive: true, force: true });
});

/**
 * Runs `bun test --changed` after an edit of each of `edits`. With `breaks`, the edit makes the file
 * throw when a run evaluates it. The result has the `--changed:` line, the test files that ran, and
 * those of them that the throw failed: a selected test that does not load the edited file passes.
 * `present` is which of `probe` exists after the run. With `nodeModules`, the case has the packages
 * of the test suite.
 */
async function changed(
  files: Fixture,
  edits: string[],
  { breaks = true, probe = [] as string[], nodeModules = false } = {},
) {
  const missing = edits.filter(edit => !(edit in files));
  if (missing.length > 0) throw new Error(`not in the fixture: ${missing.join(", ")}`);
  using dir = tempDir("test-changed-case", committedRepo(files));
  if (nodeModules)
    symlinkSync(join(import.meta.dir, "../../node_modules"), join(String(dir), "node_modules"), "junction");
  for (const edit of edits) {
    appendFileSync(join(String(dir), edit), breaks ? `\nthrow new Error("edited");\n` : "\n");
  }
  const { stderr, exitCode } = await runTestChanged(String(dir));
  const tests = Object.keys(files).filter(name => /\.test\.[cm]?[jt]s$/.test(name));
  // What a test file prints is between its header and the next one.
  const sections = stderr.split(/^(?=\S+\.test\.[cm]?[jt]s:$)/m);
  const failed = tests.filter(name => sections.some(it => it.startsWith(name + ":") && it.includes("error: edited")));
  return {
    status: /^--changed: (.*)$/m.exec(stderr)?.[1],
    ran: ranFiles(stderr, tests),
    ...(breaks ? { failed: failed.sort() } : {}),
    ...(probe.length > 0 ? { present: probe.filter(name => existsSync(join(String(dir), name))) } : {}),
    exitCode,
  };
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

// A stand-in for a component compiler: the module of a component is the code of its scripts.
const componentPlugin = String.raw`import { plugin } from "bun";
import { readFileSync } from "node:fs";

const transpiler = new Bun.Transpiler({
  loader: "tsx",
  trimUnusedImports: false,
  tsconfig: { compilerOptions: { jsx: "react", jsxFactory: "h" } },
});

plugin({
  name: "components",
  setup(build) {
    build.onLoad({ filter: /\.(svelte|vue|astro|sfc)$/ }, ({ path }) => {
      const scripts = /^---\n(.*?)\n---|<script(?:"[^"]*"|[^">])*>(.*?)<\/script>/gs;
      const code = Array.from(readFileSync(path, "utf8").matchAll(scripts), match => match[1] ?? match[2]);
      return { contents: transpiler.transformSync(code.join("\n")) + "\nexport default {};", loader: "js" };
    });
  },
});
`;

// A component is a file of markup and `<script>` blocks. A plugin of a preload file compiles it in a
// run. The scan that selects the tests runs no plugin: it reads what the scripts import.
const components = {
  "package.json": JSON.stringify({ name: "components", type: "module", sideEffects: false }),
  "bunfig.toml": `[test]\npreload = ["./component-plugin.ts"]\n`,
  "component-plugin.ts": componentPlugin,
  "dep.ts": `export const dep = 1;\n`,
  "types.ts": `export type Props = { label: string };\n`,
  // The import of a type comes first, and only the markup uses Button.
  "App.svelte": `<script lang="ts">
  import type { Props } from "./types.ts";
  import Button from "./Button.svelte";

  export let props: Props = { label: "ok" };
</script>

<Button label={props.label} />
`,
  "Button.svelte": `<script lang="ts">
  import { dep } from "./dep.ts";

  export let label: string = String(dep);
</script>

<button>{label}</button>
`,
  // The second script has the import, and its open tag has a `>` in an attribute.
  "Table.svelte": `<script module>
  export const columns = 2;
</script>

<script
  lang="ts"
  generics="T extends Record<string, number>"
>
  import { dep } from "./dep.ts";

  export let rows: T[] = [];
  export const count = rows.length + dep;
</script>

<table></table>
`,
  "Card.vue": `<script lang="ts">
export const name: string = "Card";
</script>

<script setup lang="ts">
import { dep } from "./dep.ts";

const title = String(dep);
</script>

<template>
  <h2>{{ title }}</h2>
</template>
`,
  // TypeScript cannot parse the element. One import is above it, and the import of dep.ts is below it.
  "View.vue": `<script lang="tsx">
import { h } from "./h.ts";
export const view = <p />;

import { dep } from "./dep.ts";
export const title = String(dep);
</script>
`,
  "h.ts": `export const h = (tag: string) => tag;\n`,
  "Page.astro": `---
import { dep } from "./dep.ts";

const title = String(dep);
---

<h1>{title}</h1>
`,
  // The name of a component does not matter.
  "Panel.sfc": `<script>\n  import Field from "./Field.sfc";\n</script>\n\n<Field />\n`,
  "Field.sfc": `<script>\n  import { dep } from "./dep.ts";\n\n  export const field = dep;\n</script>\n\n<input />\n`,
  // The script does not parse, and its import is above the error. A run fails on the error.
  // Only TypeScript reads as far as the import: TSX takes `<T>` for an element.
  "Broken.svelte": `<script>\n  const same = <T>(value: T) => value;\n  import { dep } from "./dep.ts";\n\n  const = same(dep);\n</script>\n`,
  // The package has no side effects, so the barrel file ui/index.ts loads ./a only for an import that asks for it.
  "Badge.svelte": `<script>\n  import { a } from "./ui";\n\n  export const badge = a;\n</script>\n`,
  "ui/index.ts": `export { a } from "./a";\nexport { b } from "./b";\n`,
  "ui/a.ts": `import { dep } from "../dep.ts";\n\nexport const a = dep;\n`,
  "ui/b.ts": `export const b = "b";\n`,
  "Static.svelte": `<p>static</p>\n`,
  "app.test.ts": testFile("app", `import App from "./App.svelte";`, "expect(App).toBeDefined();"),
  "table.test.ts": testFile("table", `import { columns } from "./Table.svelte";`, "expect(columns).toBe(2);"),
  "card.test.ts": testFile("card", "", `expect(require("./Card.vue").name).toBe("Card");`),
  "view.test.ts": testFile("view", `import { view } from "./View.vue";`, `expect(view).toBe("p");`),
  "page.test.ts": testFile("page", `import Page from "./Page.astro";`, "expect(Page).toBeDefined();"),
  "panel.test.ts": testFile("panel", `import Panel from "./Panel.sfc";`, "expect(Panel).toBeDefined();"),
  "broken.test.ts": testFile("broken", `import Broken from "./Broken.svelte";`, "expect(Broken).toBeDefined();"),
  "badge.test.ts": testFile("badge", `import { badge } from "./Badge.svelte";`, "expect(badge).toBe(1);"),
  "static.test.ts": testFile("static", `import Static from "./Static.svelte";`, "expect(Static).toBeDefined();"),
  "unrelated.test.ts": testFile("unrelated"),
};
// Each of these loads dep.ts in a run. The scan also selects broken.test.ts.
const loadDep = [
  "app.test.ts",
  "badge.test.ts",
  "card.test.ts",
  "page.test.ts",
  "panel.test.ts",
  "table.test.ts",
  "view.test.ts",
];

describe.concurrent("bun test --changed, a component", () => {
  test("an edit behind the scripts of a component", async () => {
    expect(await changed(components, ["dep.ts"])).toEqual({
      status: "1 changed file, running 8/10 test files",
      ran: [...loadDep, "broken.test.ts"].sort(),
      failed: loadDep,
      exitCode: 1,
    });
  });

  // The plugin of test/js/third_party/svelte compiles each component with the Svelte compiler.
  test("with the Svelte compiler", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "svelte-app", type: "module" }),
      ".gitignore": "node_modules\n",
      "bunfig.toml": `[test]\npreload = [${JSON.stringify(join(import.meta.dir, "../../js/third_party/svelte/bun-loader-svelte.ts"))}]\n`,
      "store.ts": `export const label = "ok";\n`,
      "Label.svelte": `<script lang="ts">\n  import { label } from "./store.ts";\n</script>\n\n<span>{label}</span>\n`,
      "App.svelte": `<script lang="ts">\n  import Label from "./Label.svelte";\n</script>\n\n<h1><Label /></h1>\n`,
      "app.test.ts": testFile(
        "app",
        `import { render } from "svelte/server";\nimport App from "./App.svelte";`,
        `expect(render(App).body).toContain("ok");`,
      ),
      "unrelated.test.ts": testFile("unrelated"),
    };
    expect(await changed(files, ["store.ts"], { nodeModules: true })).toEqual({
      status: "1 changed file, running 1/2 test files",
      ran: ["app.test.ts"],
      failed: ["app.test.ts"],
      exitCode: 1,
    });
  });

  // The scan cannot know that no plugin loads App.svelte. It reads the script, and the selected test passes.
  test("with no plugin, the test of a component is selected too", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "no-plugin", type: "module" }),
      "dep.ts": `export const dep = 1;\n`,
      "App.svelte": `<script>\n  import { dep } from "./dep.ts";\n</script>\n\n<p>{dep}</p>\n`,
      "app.test.ts": testFile("app", `import app from "./App.svelte";`, `expect(app).toEndWith("App.svelte");`),
      "unrelated.test.ts": testFile("unrelated"),
    };
    expect(await changed(files, ["dep.ts"])).toEqual({
      status: "1 changed file, running 1/2 test files",
      ran: ["app.test.ts"],
      failed: [],
      exitCode: 0,
    });
  });

  // Each row is a component, the file that its script imports, and a test that imports the component.
  // No plugin loads a component here: the rows show only what the scan takes for a script.
  test("what the scan takes for a script", async () => {
    const rows: Record<string, [file: string, text: string]> = {
      // The first `<script` is in a comment. The script comes after it.
      comment: ["Comment.svelte", `<!-- put the <script> first -->\n<script>\n  import "./comment.ts";\n</script>\n`],
      apostrophe: [
        "Apostrophe.svelte",
        `<!-- a <script> can't go here -->\n<script>\n  import "./apostrophe.ts";\n</script>\n`,
      ],
      quotes: [
        "Quotes.svelte",
        `<script lang='ts' generics='T extends Record<string, number>'>\n  import "./quotes.ts";\n</script>\n`,
      ],
      // The import is below a string that has a `<script`.
      string: ["String.svelte", `<script>\n  const tag = "<script>";\n  import("./string.ts");\n</script>\n`],
      // The first `<script` is in a comment, and the import of the script is below a string that has one.
      stray: [
        "Stray.svelte",
        `<!-- the <script> block below -->\n<script>\n  const tag = "<script>";\n  import "./stray.ts";\n</script>\n`,
      ],
      second: [
        "Second.svelte",
        `<script module>\n  export const one = 1;\n</script>\n\n<script>\n  const tag = "<script>";\n  import("./second.ts");\n</script>\n`,
      ],
      crlf: ["Crlf.astro", `---\r\nimport "./crlf.ts";\r\n---\r\n<p></p>\r\n`],
      mark: ["Mark.astro", `\uFEFF---\nimport "./mark.ts";\n---\n<p></p>\n`],
      blank: ["Blank.astro", `\n\n---\nimport "./blank.ts";\n---\n<p></p>\n`],
      fence: ["Fence.astro", `---\n// --- this line is not the end ---\nimport "./fence.ts";\n---\n<p></p>\n`],
      waits: ["Waits.astro", `---\nconst one = await Promise.resolve(1);\nimport "./waits.ts";\n---\n<p>{one}</p>\n`],
      // A macro does not run in the scan, and its file is an import like another.
      macro: [
        "Macro.svelte",
        `<script>\n  import { mark } from "./macro.ts" with { type: "macro" };\n\n  export const value = mark();\n</script>\n`,
      ],
      // Not a script: a component compiler takes `<script` in lower case only.
      upper: ["Upper.svelte", `<SCRIPT>\n  import "./upper.ts";\n</SCRIPT>\n`],
    };
    const files: Fixture = { "package.json": JSON.stringify({ name: "scripts", type: "module" }) };
    for (const [row, [file, text]] of Object.entries(rows)) {
      files[file] = text;
      files[`${row}.ts`] =
        row === "macro"
          ? `import { writeFileSync } from "node:fs";\n\nexport function mark() {\n  writeFileSync("macro-ran", "");\n  return 1;\n}\n`
          : `export {};\n`;
      files[`${row}.test.ts`] = testFile(row, `import file from "./${file}";`, "expect(file).toBeString();");
    }
    const names = Object.keys(rows);
    expect(
      await changed(
        files,
        names.map(row => `${row}.ts`),
        { breaks: false, probe: ["macro-ran"] },
      ),
    ).toEqual({
      status: "13 changed files, running 12/13 test files",
      ran: names
        .filter(row => row !== "upper")
        .map(row => `${row}.test.ts`)
        .sort(),
      present: [],
      exitCode: 0,
    });
  });

  // The scan has one row for each file. An import of a code file as text must not hide what that file imports.
  test("a script that imports a code file as text", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "as-text", type: "module" }),
      "Source.svelte": `<script>\n  import text from "./shown" with { type: "text" };\n\n  export const size = text.length;\n</script>\n`,
      "shown.ts": `export { two } from "./two.ts";\n`,
      "two.ts": `export const two = 2;\n`,
      "a.ts": `export * from "./b.ts";\n`,
      "b.ts": `export * from "./c.ts";\n`,
      "c.ts": `export * from "./shown.ts";\n`,
      "shown.test.ts": testFile(
        "shown",
        `import source from "./Source.svelte";\nimport { two } from "./a.ts";`,
        "expect([source, two]).toHaveLength(2);",
      ),
    };
    expect(await changed(files, ["two.ts"])).toEqual({
      status: "1 changed file, running 1/1 test file",
      ran: ["shown.test.ts"],
      failed: ["shown.test.ts"],
      exitCode: 1,
    });
  });

  // Each `<script` that does not end is one more script to try. The scan reads each byte twice at most.
  test("a file with thousands of scripts that do not end", async () => {
    const lines = (line: string, count: number) => Buffer.alloc(line.length * count, line).toString();
    const files = {
      "package.json": JSON.stringify({ name: "many-scripts", type: "module" }),
      "Values.svelte": lines("<script>x\n", 10_000),
      "Returns.svelte": lines("<script>return;\n", 6_000),
      "many.test.ts": testFile(
        "many",
        `import values from "./Values.svelte";\nimport returns from "./Returns.svelte";`,
        "expect([values, returns]).toHaveLength(2);",
      ),
      "dep.ts": `export const dep = 1;\n`,
      "dep.test.ts": testFile("dep", `import { dep } from "./dep.ts";`, "expect(dep).toBe(1);"),
    };
    expect(await changed(files, ["dep.ts"], { breaks: false })).toEqual({
      status: "1 changed file, running 1/2 test files",
      ran: ["dep.test.ts"],
      exitCode: 0,
    });
  });

  // The scan does not read a file with no `<script`, or a binary file.
  test("a file that is not a component stays an asset", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "assets", type: "module" }),
      "notes.dat": `import "./notes-dep.ts";\n`,
      "blob.dat": Buffer.from(`\0<script>\n  import "./blob-dep.ts";\n</script>\n`),
      "notes-dep.ts": `export {};\n`,
      "blob-dep.ts": `export {};\n`,
      "assets.test.ts": testFile(
        "assets",
        `import notes from "./notes.dat";\nimport blob from "./blob.dat";`,
        "expect([notes, blob]).toHaveLength(2);",
      ),
    };
    expect(await changed(files, ["notes-dep.ts", "blob-dep.ts"], { breaks: false })).toEqual({
      status: "2 changed files, but no test files are affected",
      ran: [],
      exitCode: 0,
    });
  });

  // The scan holds m.ts twice: for m.test.ts, and for the page that the script reaches. An edit of it starts at both.
  test("a script that reaches a page does not hide a test of a file of that page", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "reaches-page", type: "module" }),
      "page.html": `<!doctype html>\n<html>\n  <body>\n    <script type="module" src="./client.ts"></script>\n  </body>\n</html>\n`,
      "client.ts": `import { m } from "./m.ts";\nconsole.log(m);\n`,
      "server.ts": `import page from "./page.html";\n\nexport const routes = { "/": page };\n`,
      "App.svelte": `<script>\n  import { routes } from "./server.ts";\n\n  export const all = routes;\n</script>\n`,
      "m.ts": `export const m = 1;\n`,
      "m.test.ts": testFile("m", `import { m } from "./m.ts";`, "expect(m).toBe(1);"),
      "app.test.ts": testFile("app", `import app from "./App.svelte";`, "expect(app).toBeString();"),
    };
    expect(await changed(files, ["m.ts"])).toEqual({
      status: "1 changed file, running 1/2 test files",
      ran: ["m.test.ts"],
      failed: ["m.test.ts"],
      exitCode: 1,
    });
  });

  // The bundler of `Bun.serve` loads what a page imports. The plugin of a preload file is not part of it, so
  // there a component is an asset, and the scan does not read it.
  test("a component that a page imports stays an asset", async () => {
    const files = {
      "package.json": JSON.stringify({ name: "component-page", type: "module" }),
      "page.html": `<!doctype html>\n<html>\n  <body>\n    <script type="module" src="./client.ts"></script>\n  </body>\n</html>\n`,
      "client.ts": `import App from "./App.svelte";\nconsole.log(App);\n`,
      "App.svelte": `<script>\n  import { m } from "./m.ts";\n</script>\n\n<p>{m}</p>\n`,
      "m.ts": `export const m = 1;\n`,
      "m.test.ts": testFile("m", `import { m } from "./m.ts";`, "expect(m).toBe(1);"),
      "page.test.ts": testFile("page", `import page from "./page.html";`, "expect(page).toBeDefined();"),
    };
    expect(await changed(files, ["m.ts"])).toEqual({
      status: "1 changed file, running 1/2 test files",
      ran: ["m.test.ts"],
      failed: ["m.test.ts"],
      exitCode: 1,
    });
  });

  // Only the scan of `bun test --changed` reads the scripts of a component. A build copies the file.
  test("bun build copies a component", async () => {
    using dir = tempDir("test-changed-build-component", {
      "entry.js": `import app from "./App.svelte";\nconsole.log(app);\n`,
      "App.svelte": `<script>\n  import "./not-there";\n</script>\n`,
    });
    const build = await Bun.build({ entrypoints: [join(String(dir), "entry.js")], target: "bun" });
    expect(build.outputs.map(output => output.kind).sort()).toEqual(["asset", "entry-point"]);
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

  test("an edit behind a component reruns the tests that load it", async () => {
    using dir = tempDir("test-changed-watch-component", committedRepo(components));

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

    // The watcher has dep.ts only if the scan found it behind the components.
    const before = buf.length;
    appendFileSync(join(String(dir), "dep.ts"), "// touched\n");
    await waitFor("across 8 files", before);
    expect(ranFiles(buf.slice(before), Object.keys(components))).toEqual([...loadDep, "broken.test.ts"].sort());

    proc.kill();
    reader.releaseLock();
  });
});
