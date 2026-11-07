/**
 * scripts/sync-react-compiler.sh prints what facebook/react changed in the React Compiler since the commit in
 * src/react_compiler/UPSTREAM_PORTED.
 *
 * The test runs a copy of the script, with an UPSTREAM_PORTED of its own beside it, against a local repository that
 * stands in for facebook/react: git rewrites the script's URL to it (`url.<base>.insteadOf`) and refuses every
 * transport but `file`, so the script cannot reach the real one.
 *
 * The script is bash for the macOS and Linux machines the port is maintained on, hence the skip on Windows. The macOS
 * lanes are where it meets the bash and the tools that macOS ships, and they do not run test/internal/source-lints/,
 * which is why the test is here.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const script = readFileSync(join(import.meta.dir, "..", "..", "scripts", "sync-react-compiler.sh"), "utf8");
const crates = "compiler/crates";

const source = (name: string, revision: number) => `pub fn ${name}() -> u32 { ${revision} }\n`;
const astConsumer = (name: string, revision: number) => `use react_compiler_ast::File;\n${source(name, revision)}`;

describe.skipIf(isWindows || !Bun.which("git") || !Bun.which("bash"))("scripts/sync-react-compiler.sh", () => {
  let root: ReturnType<typeof tempDir>;
  let env: Record<string, string | undefined>;
  /** The commit in UPSTREAM_PORTED, the one after it, and the tip of `main`. */
  let ported: string, second: string, main: string;

  beforeAll(async () => {
    root = tempDir("sync-react-compiler", {
      home: {},
      repo: { "scripts/sync-react-compiler.sh": script, "src/react_compiler/UPSTREAM_PORTED": "" },
      upstream: {
        [crates]: {
          // Whole-crate ports.
          "react_compiler_hir/src/lib.rs": source("hir", 1),
          "react_compiler_reactive_scopes/src/prune_unused_labels.rs": source("prune", 1),
          // In the directory of a whole-crate port, and not part of it: an AST-boundary port, and a file Bun does
          // not have.
          "react_compiler_reactive_scopes/src/codegen_reactive_function.rs": astConsumer("codegen", 1),
          "react_compiler_hir/src/print.rs": source("print", 1),
          // An AST-boundary port.
          "react_compiler_lowering/src/build_hir.rs": astConsumer("lower", 1),
          // Not ported, and names react_compiler_ast at the ported commit already.
          "react_compiler/src/fixture_utils.rs": astConsumer("fixture", 1),
          "react_compiler_ast/src/lib.rs": "pub struct File;\n",
        },
      },
    });
    const upstream = join(String(root), "upstream");
    env = {
      // No git configuration but the one below: not the system's, not the user's, and not the caller's. In a git hook
      // the caller has GIT_DIR, and git would then work on that repository.
      ...Object.fromEntries(Object.entries(bunEnv).filter(([name]) => !name.startsWith("GIT_"))),
      HOME: join(String(root), "home"),
      XDG_CONFIG_HOME: join(String(root), "home"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_ALLOW_PROTOCOL: "file",
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(upstream).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: "https://github.com/facebook/react.git",
      // A fetch starts `git maintenance` in the background. It can still run when the script removes its clone.
      GIT_CONFIG_KEY_1: "maintenance.auto",
      GIT_CONFIG_VALUE_1: "false",
      // The script reads what `git grep` prints. A colour in it must not change the list of new consumers.
      GIT_CONFIG_KEY_2: "color.grep",
      GIT_CONFIG_VALUE_2: "always",
      // Nothing on stderr but what the script prints: `git init` warns when git has no templates directory, and bash
      // warns about a locale that is not installed.
      GIT_TEMPLATE_DIR: "",
      LC_ALL: "C",
    };
    const git = async (...args: string[]) => {
      await using proc = Bun.spawn({ cmd: ["git", ...args], cwd: upstream, env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) throw new Error(`git ${args.join(" ")} exited with ${exitCode}: ${stderr}`);
      return stdout.trim();
    };
    const commit = async (files: Record<string, string>) => {
      for (const [path, contents] of Object.entries(files)) writeFileSync(join(upstream, crates, path), contents);
      await git("add", "-A");
      await git("commit", "--quiet", "-m", "commit");
      return await git("rev-parse", "HEAD");
    };

    await git("-c", "init.defaultBranch=main", "init", "--quiet");
    ported = await commit({});
    // An annotated tag: the script has to resolve it to the commit, not to the tag object.
    await git("tag", "--annotate", "-m", "tag", "ported-tag", ported);
    second = await commit({ "react_compiler_hir/src/lib.rs": source("hir", 2) });
    main = await commit({
      "react_compiler_reactive_scopes/src/prune_unused_labels.rs": source("prune", 3),
      "react_compiler_reactive_scopes/src/codegen_reactive_function.rs": astConsumer("codegen", 3),
      "react_compiler_hir/src/print.rs": source("print", 3),
      "react_compiler_lowering/src/build_hir.rs": astConsumer("lower", 3),
      // New upstream, and names react_compiler_ast. The script has the first as an AST-boundary port.
      // Bun has to port the second.
      "react_compiler_lowering/src/hir_builder.rs": astConsumer("builder", 3),
      "react_compiler_lowering/src/source_location.rs": astConsumer("convert_base_loc", 3),
      // New upstream, and nothing to port: a file of react_compiler_ast itself, and a file that names another crate.
      "react_compiler_ast/src/scope.rs": astConsumer("scope", 3),
      "react_compiler/src/timing.rs": "use react_compiler_ast_extras::Timer;\n",
    });
    writeFileSync(join(String(root), "repo", "src", "react_compiler", "UPSTREAM_PORTED"), ported + "\n");
  });

  afterAll(() => root?.[Symbol.dispose]());

  /** Runs the script. Of each diff in its output only the `---`, `+++`, `-` and `+` lines are kept. */
  async function sync(args: string[] = [], gitConfig: Record<string, string> = {}) {
    const repo = join(String(root), "repo");
    await using proc = Bun.spawn({
      cmd: ["bash", join(repo, "scripts", "sync-react-compiler.sh"), ...args],
      env: { ...env, ...gitConfig },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = (output: string) =>
      output
        .replaceAll(ported, "<ported>")
        .replaceAll(second, "<second>")
        .replaceAll(main, "<main>")
        .replaceAll(repo, "<repo>")
        .split("\n");
    return {
      stdout: lines(stdout).filter(
        line => line.startsWith("   port: ") || !/^( |diff --git |index |new file mode |@@ |$)/.test(line),
      ),
      stderr: lines(stderr.trimEnd()),
      exitCode,
    };
  }

  test.concurrent("diffs the ported commit against upstream's main", async () => {
    expect(await sync()).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": [
          "Fetching facebook/react @ {<ported>, main} ...",
        ],
        "stdout": [
          "UPSTREAM_PORTED: <ported>",
          "UPSTREAM_HEAD:   <main>",
          "### whole-crate ports (apply mechanically) ###",
          "── compiler/crates/react_compiler_hir/src",
          "   port: src/react_compiler/hir",
          "--- a/compiler/crates/react_compiler_hir/src/lib.rs",
          "+++ b/compiler/crates/react_compiler_hir/src/lib.rs",
          "-pub fn hir() -> u32 { 1 }",
          "+pub fn hir() -> u32 { 2 }",
          "── compiler/crates/react_compiler_reactive_scopes/src",
          "   port: src/react_compiler/reactive_scopes",
          "--- a/compiler/crates/react_compiler_reactive_scopes/src/prune_unused_labels.rs",
          "+++ b/compiler/crates/react_compiler_reactive_scopes/src/prune_unused_labels.rs",
          "-pub fn prune() -> u32 { 1 }",
          "+pub fn prune() -> u32 { 3 }",
          "### AST-boundary ports (re-port via DESIGN.md type map) ###",
          "── compiler/crates/react_compiler_lowering/src/build_hir.rs",
          "   port: src/react_compiler/lowering/build_hir/",
          "--- a/compiler/crates/react_compiler_lowering/src/build_hir.rs",
          "+++ b/compiler/crates/react_compiler_lowering/src/build_hir.rs",
          "-pub fn lower() -> u32 { 1 }",
          "+pub fn lower() -> u32 { 3 }",
          "── compiler/crates/react_compiler_lowering/src/hir_builder.rs",
          "   port: src/react_compiler/lowering/hir_builder.rs",
          "--- /dev/null",
          "+++ b/compiler/crates/react_compiler_lowering/src/hir_builder.rs",
          "+use react_compiler_ast::File;",
          "+pub fn builder() -> u32 { 3 }",
          "── compiler/crates/react_compiler_reactive_scopes/src/codegen_reactive_function.rs",
          "   port: src/react_compiler/codegen.rs",
          "--- a/compiler/crates/react_compiler_reactive_scopes/src/codegen_reactive_function.rs",
          "+++ b/compiler/crates/react_compiler_reactive_scopes/src/codegen_reactive_function.rs",
          "-pub fn codegen() -> u32 { 1 }",
          "+pub fn codegen() -> u32 { 3 }",
          "── compiler/crates/react_compiler_hir/src/print.rs",
          "   port: (not ported; debug printer, no caller in Bun)",
          "--- a/compiler/crates/react_compiler_hir/src/print.rs",
          "+++ b/compiler/crates/react_compiler_hir/src/print.rs",
          "-pub fn print() -> u32 { 1 }",
          "+pub fn print() -> u32 { 3 }",
          "### new react_compiler_ast consumers (need new Bun port) ###",
          "compiler/crates/react_compiler_lowering/src/source_location.rs",
          "When porting is done: echo <main> > <repo>/src/react_compiler/UPSTREAM_PORTED",
        ],
      }
    `);
  });

  test.concurrent("diffs the ported commit against the commit it is given", async () => {
    expect(await sync([second])).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": [
          "Fetching facebook/react @ {<ported>, <second>} ...",
        ],
        "stdout": [
          "UPSTREAM_PORTED: <ported>",
          "UPSTREAM_HEAD:   <second>",
          "### whole-crate ports (apply mechanically) ###",
          "── compiler/crates/react_compiler_hir/src",
          "   port: src/react_compiler/hir",
          "--- a/compiler/crates/react_compiler_hir/src/lib.rs",
          "+++ b/compiler/crates/react_compiler_hir/src/lib.rs",
          "-pub fn hir() -> u32 { 1 }",
          "+pub fn hir() -> u32 { 2 }",
          "### AST-boundary ports (re-port via DESIGN.md type map) ###",
          "### new react_compiler_ast consumers (need new Bun port) ###",
          "(none)",
          "When porting is done: echo <second> > <repo>/src/react_compiler/UPSTREAM_PORTED",
        ],
      }
    `);
  });

  test.concurrent("has nothing to diff when the ref it is given is the ported commit", async () => {
    expect(await sync(["ported-tag"])).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": [
          "Fetching facebook/react @ {<ported>, ported-tag} ...",
        ],
        "stdout": [
          "UPSTREAM_PORTED: <ported>",
          "UPSTREAM_HEAD:   <ported>",
          "Already up to date.",
        ],
      }
    `);
  });

  test.concurrent("stops when it cannot list the files that name react_compiler_ast", async () => {
    // `git grep` does not run with this value.
    const grepFails = { GIT_CONFIG_COUNT: "4", GIT_CONFIG_KEY_3: "grep.threads", GIT_CONFIG_VALUE_3: "-1" };
    const { stdout, stderr, exitCode } = await sync([], grepFails);
    expect({ lastLine: stdout.at(-1), stderr, exitCode }).toEqual({
      lastLine: "### new react_compiler_ast consumers (need new Bun port) ###",
      stderr: [
        "Fetching facebook/react @ {<ported>, main} ...",
        "fatal: invalid number of threads specified (-1) for grep.threads",
      ],
      exitCode: 1,
    });
  });
});
