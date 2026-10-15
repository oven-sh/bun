// Tests for `--staged` and `--changed` in `bun lint` and `bun fmt`.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// An empty global git config, so the machine's own config doesn't affect the tests.
const machine = tempDir("bun-lint-git-config", { "gitconfig": "" });
afterAll(() => machine[Symbol.dispose]());

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: join(String(machine), "gitconfig"),
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

type Env = Record<string, string | undefined>;

async function run(cmd: string[], cwd: string, more: Env = {}) {
  await using proc = spawn({ cmd, cwd, env: { ...env, ...more }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const bun = (cwd: string, args: string[], more?: Env) => run([bunExe(), ...args], cwd, more);

async function git(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await run(["git", ...args], cwd);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${stderr}`);
  return stdout;
}

/** Creates a repository on `main`. If there are any `files`, they go into a first commit. */
async function repository(files: Record<string, string>) {
  const dir = tempDir("bun-lint-git", files);
  const root = realpathSync(String(dir));
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "commit.gpgsign", "false");
  await git(root, "config", "core.autocrlf", "false");
  if (Object.keys(files).length > 0) await commit(root);
  return { root, [Symbol.dispose]: () => dir[Symbol.dispose]() };
}

async function commit(root: string) {
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "a commit");
}

const write = (root: string, name: string, text: string) => {
  mkdirSync(join(root, name, ".."), { recursive: true });
  writeFileSync(join(root, name), text);
};
const read = (root: string, name: string) => readFileSync(join(root, name), "utf8");

/** Returns the files a run would process, as paths relative to `root`. */
async function selected(root: string, cwd: string, args: string[], more?: Env) {
  const { stdout, stderr, exitCode } = await bun(cwd, [...args, "--list-files"], more);
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
  const names = stdout.split("\n").filter(it => it !== "");
  return names.map(it => relative(root, resolve(cwd, it)).replaceAll("\\", "/")).sort();
}

const commands = ["lint", "fmt"] as const;
// Code that both `--fix` and `bun fmt` change, and what each turns it into.
const before = "let a   = 1;\nexport { a };\n";
const after = { lint: "const a   = 1;\nexport { a };\n", fmt: "let a = 1;\nexport { a };\n" };
const done = { lint: "fixed", fmt: "formatted" };
const verb = { lint: "lint", fmt: "format" };
const writing = { lint: ["lint", "--fix", "--rule", "prefer-const: error"], fmt: ["fmt"] };
const tidy = "export const a = 1;\n";

describe.concurrent.each(commands)("bun %s", command => {
  test("--staged selects the files whose staged version differs from HEAD", async () => {
    using repo = await repository({
      "modified.js": tidy,
      "unstaged.js": tidy,
      "same.js": tidy,
      "deleted.js": tidy,
      "old-name.js": "export const renamed = 1;\n",
      "sub/modified.js": tidy,
    });
    const { root } = repo;
    const odd = isWindows ? "ünï côde.js" : 'ünï "cô\tde".js';
    for (const name of ["modified.js", "sub/modified.js", "added.js", odd]) write(root, name, before);
    rmSync(join(root, "deleted.js"));
    renameSync(join(root, "old-name.js"), join(root, "new-name.js"));
    await git(root, "add", "-A");
    write(root, "unstaged.js", before);
    write(root, "untracked.js", before);

    const all = ["added.js", "modified.js", "new-name.js", "sub/modified.js", odd].sort();
    expect(await selected(root, root, [command, "--staged"])).toEqual(all);
    // In a subdirectory, arguments are relative to it, but git's paths are relative to the repository root.
    expect(await selected(root, join(root, "sub"), [command, "--staged"])).toEqual(["sub/modified.js"]);
    expect(await selected(root, join(root, "sub"), [command, "--staged", ".."])).toEqual(all);
    // Config that changes how git prints paths makes no difference.
    await git(root, "config", "diff.relative", "true");
    await git(root, "config", "diff.renames", "copies");
    expect(await selected(root, join(root, "sub"), [command, "--staged", ".."])).toEqual(all);
  });

  test("--changed selects files that differ from the merge base with the default branch, and untracked files", async () => {
    using repo = await repository({
      "a.js": tidy,
      "b.js": tidy,
      "c.js": tidy,
      "d.js": tidy,
      ".gitignore": "ignored.js\n",
    });
    const { root } = repo;
    await git(root, "checkout", "-q", "-b", "feature");
    write(root, "a.js", before);
    await commit(root);
    // The default branch moves on.
    await git(root, "checkout", "-q", "main");
    write(root, "d.js", before);
    await commit(root);
    await git(root, "checkout", "-q", "feature");
    write(root, "b.js", before);
    await git(root, "add", "b.js");
    write(root, "c.js", before);
    write(root, "sub/untracked.js", before);
    write(root, "ignored.js", before);

    const all = ["a.js", "b.js", "c.js", "sub/untracked.js"];
    expect(await selected(root, root, [command, "--changed"])).toEqual(all);
    expect(await selected(root, join(root, "sub"), [command, "--changed", ".."])).toEqual(all);
    expect(await selected(root, root, [command, "--changed=HEAD"])).toEqual(["b.js", "c.js", "sub/untracked.js"]);
    expect(await selected(root, root, [command, "--changed=main"])).toEqual([...all, "d.js"].sort());
    await git(root, "tag", "-a", "-m", "a tag", "v1", "main~1");
    expect(await selected(root, root, [command, "--changed=v1"])).toEqual(all);
    // Without `=`, the next argument is a file, not a ref.
    expect(await selected(root, root, [command, "--changed", "a.js", "d.js"])).toEqual(["a.js"]);
  });

  test("--changed tries origin/HEAD, then main, then master, and lists them if none exists", async () => {
    using repo = await repository({ "a.js": tidy, "b.js": tidy, "c.js": tidy });
    const { root } = repo;
    const first = (await git(root, "rev-parse", "HEAD")).trim();
    write(root, "a.js", before);
    await commit(root);
    await git(root, "branch", "master");
    write(root, "b.js", before);
    await commit(root);
    await git(root, "checkout", "-q", "-b", "feature");
    write(root, "c.js", before);
    await commit(root);

    expect(await selected(root, root, [command, "--changed"])).toEqual(["c.js"]);
    await git(root, "branch", "-q", "-D", "main");
    expect(await selected(root, root, [command, "--changed"])).toEqual(["b.js", "c.js"]);
    await git(root, "update-ref", "refs/remotes/origin/trunk", first);
    await git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    expect(await selected(root, root, [command, "--changed"])).toEqual(["a.js", "b.js", "c.js"]);

    await git(root, "symbolic-ref", "-d", "refs/remotes/origin/HEAD");
    await git(root, "branch", "-q", "-D", "master");
    const { stdout, stderr, exitCode } = await bun(root, [command, "--changed"]);
    expect(stderr).toContain("--changed cannot find the default branch");
    expect(stderr).toContain("It tried origin/HEAD, main and master. Name a branch or a commit with --changed=<ref>");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
  });

  test("--changed=<ref> only accepts a single commit, not flags, ranges or paths", async () => {
    using repo = await repository({ "a.js": tidy });
    const { root } = repo;
    write(root, "a.js", before);
    for (const written of ["nothing", "--output=written.txt", "-O", "HEAD..HEAD", "HEAD HEAD", "HEAD:a.js"]) {
      const { stdout, stderr, exitCode } = await bun(root, [command, `--changed=${written}`]);
      expect(stderr).toContain(`"${written}" is not a branch, tag or commit in this repository`);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    }
    expect(existsSync(join(root, "written.txt"))).toBe(false);
    expect(read(root, "a.js")).toBe(before);
  });

  test("--staged and --changed only narrow down what the arguments and ignore files select", async () => {
    using repo = await repository({
      "src/a.js": tidy,
      "lib/a.js": tidy,
      "lib/tracked-and-ignored.js": tidy,
      "a.txt": "a\n",
    });
    const { root } = repo;
    for (const name of ["src/a.js", "lib/a.js", "lib/tracked-and-ignored.js", "a.txt", "node_modules/a/a.js"]) {
      write(root, name, before);
    }
    write(root, ".gitignore", "tracked-and-ignored.js\n");
    await git(root, "add", "-A", "-f");

    const without = await selected(root, root, [command]);
    for (const flag of ["--staged", "--changed"]) {
      expect(await selected(root, root, [command, flag])).toEqual(without);
      expect(await selected(root, root, [command, flag, "src"])).toEqual(["src/a.js"]);
      expect(await selected(root, root, [command, flag, "lib/*.js"])).toEqual(["lib/a.js"]);
      expect(await selected(root, root, [command, flag, "--ignore-pattern", "lib"])).toEqual(["src/a.js"]);
      // A mistyped path is still an error.
      const { exitCode } = await bun(root, [command, flag, "scr"]);
      expect(exitCode).toBe(2);
    }
    expect(without).toEqual(["lib/a.js", "src/a.js"]);
  });

  test("a run with no files left says so and exits with 0", async () => {
    using repo = await repository({ "a.js": before, "b.js": tidy });
    const { root } = repo;
    expect(await bun(root, [command, "--staged"])).toEqual({
      stdout: "",
      stderr: `No staged files to ${verb[command]}\n`,
      exitCode: 0,
    });
    expect(await bun(root, [command, "--changed"])).toEqual({
      stdout: "",
      stderr: `No changed files to ${verb[command]}\n`,
      exitCode: 0,
    });
    // A file is staged, but the argument names a different one.
    write(root, "b.js", before);
    await git(root, "add", "b.js");
    const { stderr, exitCode } = await bun(root, [command, "--staged", "a.js"]);
    expect({ stderr, exitCode }).toEqual({ stderr: `No staged files to ${verb[command]}\n`, exitCode: 0 });
    expect(read(root, "a.js")).toBe(before);
  });

  test("in a repository without commits, --staged works and --changed is an error", async () => {
    using repo = await repository({});
    const { root } = repo;
    write(root, "staged.js", before);
    await git(root, "add", "-A");
    write(root, "untracked.js", before);
    expect(await selected(root, root, [command, "--staged"])).toEqual(["staged.js"]);
    const { stdout, stderr, exitCode } = await bun(root, [command, "--changed"]);
    expect(stderr).toContain("--changed has nothing to compare with, because this repository has no commits");
    expect(stderr).toContain("Use --staged for the files that you have added");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
  });

  test.each(["--staged", "--changed"])("%s is an error outside a repository or without git", async flag => {
    using dir = tempDir("bun-lint-git", { "a.js": before, "empty/.keep": "" });
    const root = realpathSync(String(dir));
    const outside = await bun(root, [command, flag], { GIT_CEILING_DIRECTORIES: join(root, "..") });
    expect(outside.stderr).toContain(`${flag} needs a git repository`);
    expect(outside.stderr).toMatch(/\n.*  fatal: not a git repository/);
    expect({ stdout: outside.stdout, exitCode: outside.exitCode }).toEqual({ stdout: "", exitCode: 2 });

    const without = await bun(root, [command, flag], { PATH: join(root, "empty"), Path: undefined });
    expect(without.stderr).toContain("Cannot find git in PATH");
    expect({ stdout: without.stdout, exitCode: without.exitCode }).toEqual({ stdout: "", exitCode: 2 });
    expect(read(root, "a.js")).toBe(before);
  });

  test("--staged can't be combined with --changed or stdin", async () => {
    using repo = await repository({ "a.js": tidy });
    const together = await bun(repo.root, [command, "--staged", "--changed"]);
    expect(together.stderr).toContain("--staged and --changed cannot be used together");
    expect(together.exitCode).toBe(2);
    const stdin = command === "lint" ? ["--stdin"] : ["--stdin-filepath", "a.js"];
    const piped = await bun(repo.root, [command, "--staged", ...stdin]);
    expect(piped.stderr).toContain(`--staged and ${stdin[0]} cannot be used together`);
    expect(piped.exitCode).toBe(2);
  });

  test("symlinks are skipped, and a nested repository is a separate repository", async () => {
    using repo = await repository({ "a.js": tidy });
    const { root } = repo;
    write(root, "inner/a.js", tidy);
    await git(join(root, "inner"), "init", "-q", "-b", "main");
    await commit(join(root, "inner"));
    write(root, "inner/a.js", before);
    await git(join(root, "inner"), "add", "-A");
    if (!isWindows) symlinkSync("a.js", join(root, "link.js"));
    write(root, "b.js", before);
    await git(root, "add", "-A");

    for (const flag of ["--staged", "--changed"]) {
      expect(await selected(root, root, [command, flag])).toEqual(["b.js"]);
      expect(await selected(root, join(root, "inner"), [command, flag])).toEqual(["inner/a.js"]);
    }
  });

  // On macOS /tmp is such a link, and so is $PWD in a shell that got to the repository through one.
  test.skipIf(isWindows)(
    "files that are named through a link to the repository are selected, written and staged",
    async () => {
      using repo = await repository({ "src/a.js": tidy, "src/partly.js": tidy, "b.js": tidy });
      const { root } = repo;
      using outside = tempDir("bun-lint-git-link", {});
      // The link is above the repository. `bun fmt` doesn't take an argument that is itself a link, like Prettier.
      symlinkSync(join(root, ".."), join(String(outside), "link"));
      const link = join(realpathSync(String(outside)), "link", basename(root));
      for (const name of ["src/a.js", "src/partly.js"]) write(root, name, before);
      await git(root, "add", "-A");
      write(root, "src/partly.js", before + "\n");
      write(root, "b.js", before);

      // The names are printed relative to the real working directory, and go through the link.
      const found = async (cwd: string, args: string[]) => {
        const { stdout, stderr, exitCode } = await bun(cwd, [command, ...args, "--list-files"]);
        expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const names = stdout.split("\n").filter(it => it !== "");
        return names.map(it => relative(root, realpathSync(resolve(root, it)))).sort();
      };
      for (const cwd of [root, link]) {
        for (const flag of ["--staged", "--changed"]) {
          const also = flag === "--changed" ? ["b.js"] : [];
          expect(await found(cwd, [flag, link])).toEqual([...also, "src/a.js", "src/partly.js"]);
          expect(await found(cwd, [flag, join(link, "src")])).toEqual(["src/a.js", "src/partly.js"]);
          expect(await found(cwd, [flag, join(link, "src/a.js")])).toEqual(["src/a.js"]);
        }
      }

      const { stderr, exitCode } = await bun(root, [...writing[command], "--staged", join(link, "src")]);
      expect(stderr).toContain("src/partly.js has both staged and unstaged changes");
      expect(exitCode).toBe(2);
      expect(read(root, "src/a.js")).toBe(after[command]);
      expect(read(root, "src/partly.js")).toBe(before + "\n");
      // a.js was staged again, so only what was unstaged before still is.
      expect(await git(root, "diff", "--name-only")).toBe("b.js\nsrc/partly.js\n");
    },
  );

  test("a fully staged file is staged again after it's rewritten", async () => {
    using repo = await repository({ "a.js": tidy, "sub/b.js": tidy, "c.js": tidy });
    const { root } = repo;
    // File names aren't passed to git as patterns. As a pattern, `*.js` would stage c.js too.
    const names = [...(isWindows ? [] : ["*.js"]), "a.js", "new.js", "sub/b.js"];
    for (const name of names) write(root, name, before);
    await git(root, "add", "-A");
    write(root, "c.js", before);

    const { stderr, exitCode } = await bun(join(root, "sub"), [...writing[command], "--staged", ".."]);
    expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(await git(root, "diff", "--name-only")).toBe("c.js\n");
    expect((await git(root, "diff", "--name-only", "--cached")).split("\n").filter(Boolean)).toEqual(names);
    for (const name of names) expect(await git(root, "show", `:${name}`)).toBe(after[command]);
    expect(read(root, "c.js")).toBe(before);
  });

  test("--changed stages nothing", async () => {
    using repo = await repository({ "a.js": tidy });
    const { root } = repo;
    write(root, "a.js", before);
    await git(root, "add", "-A");
    const { exitCode } = await bun(root, [...writing[command], "--changed"]);
    expect(read(root, "a.js")).toBe(after[command]);
    expect(await git(root, "status", "--porcelain")).toBe("MM a.js\n");
    expect(exitCode).toBe(0);
  });

  test("a file with both staged and unstaged changes isn't written", async () => {
    using repo = await repository({ "partly.js": tidy, "sub/partly.js": tidy, "whole.js": tidy, "tidy.js": tidy });
    const { root } = repo;
    for (const name of ["partly.js", "whole.js"]) write(root, name, before);
    write(root, "tidy.js", tidy + tidy.replace("a", "b"));
    await git(root, "add", "-A");
    const more = before + "export const unstaged = 1;\n";
    write(root, "partly.js", more);
    // tidy.js is partly staged too, but needs no rewrite, so it isn't an error.
    write(root, "tidy.js", tidy);

    const one = await bun(root, [...writing[command], "--staged"]);
    expect(one.stderr).toContain(`partly.js has both staged and unstaged changes, so it was not ${done[command]}`);
    expect(one.stderr).not.toContain("No problems");
    expect(one.stderr).toContain(
      "Stage the rest with git add, or put it away with git stash --keep-index. Then run this again.",
    );
    expect(one.stderr).not.toContain("tidy.js");
    expect(one.exitCode).toBe(2);
    expect(read(root, "partly.js")).toBe(more);
    expect(await git(root, "status", "--porcelain")).toBe("MM partly.js\nMM tidy.js\nM  whole.js\n");
    expect(await git(root, "show", ":whole.js")).toBe(after[command]);

    write(root, "sub/partly.js", before);
    await git(root, "add", "sub");
    write(root, "sub/partly.js", more);
    const two = await bun(join(root, "sub"), [...writing[command], "--staged", ".."]);
    expect(two.stderr).toMatch(
      /2 files have both staged and unstaged changes, so they were not \w+\n.*  \.\.\/partly\.js\n.*  partly\.js\n/,
    );
    expect(two.exitCode).toBe(2);
    expect(read(root, "sub/partly.js")).toBe(more);

    // A run that doesn't write files has nothing to reject.
    const looking = command === "lint" ? ["lint", "--rule", "prefer-const: error"] : ["fmt", "--check"];
    const three = await bun(root, [...looking, "--staged"]);
    expect(three.stderr).not.toContain("unstaged");
    expect(three.exitCode).toBe(1);
  });

  test.skipIf(isWindows)("works in a pre-commit hook, on the index of that commit", async () => {
    using repo = await repository({ "a.js": tidy, "b.js": tidy });
    const { root } = repo;
    const hook = join(root, ".git/hooks/pre-commit");
    const words = [bunExe(), ...writing[command], "--staged"].map(it => `'${it}'`).join(" ");
    writeFileSync(hook, `#!/bin/sh\nexec ${words}\n`);
    chmodSync(hook, 0o755);

    write(root, "a.js", before);
    await git(root, "add", "a.js");
    await git(root, "commit", "-q", "-m", "what is staged");
    expect(await git(root, "show", "HEAD:a.js")).toBe(after[command]);
    // `git commit -a` gives the hook a separate index file.
    write(root, "b.js", before);
    await git(root, "commit", "-q", "-a", "-m", "all");
    expect(await git(root, "show", "HEAD:b.js")).toBe(after[command]);
    expect(await git(root, "status", "--porcelain")).toBe("");
  });

  test.skipIf(isWindows)("git never runs programs named in the repository's config", async () => {
    using repo = await repository({ "a.js": tidy, "b.js": tidy, ".gitattributes": "*.js diff=mine\n" });
    const { root } = repo;
    const program = join(root, "program.sh");
    writeFileSync(program, `#!/bin/sh\necho ran >> '${join(root, "ran.txt")}'\n`);
    chmodSync(program, 0o755);
    for (const key of ["diff.external", "diff.mine.textconv", "diff.mine.command", "core.pager", "pager.diff"]) {
      await git(root, "config", key, program);
    }
    write(root, "a.js", before);
    await git(root, "add", "a.js");
    write(root, "b.js", before);
    const more = { GIT_EXTERNAL_DIFF: program, GIT_PAGER: program, PAGER: program };
    expect(await selected(root, root, [command, "--staged"], more)).toEqual(["a.js"]);
    expect(await selected(root, root, [command, "--changed"], more)).toEqual(["a.js", "b.js"]);
    const { exitCode } = await bun(root, [...writing[command], "--staged"], more);
    expect(existsSync(join(root, "ran.txt"))).toBe(false);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("bun lint --staged -f json prints an empty result if nothing is staged", async () => {
  using repo = await repository({ "a.js": before });
  const { stdout, stderr, exitCode } = await bun(repo.root, ["lint", "--staged", "-f", "json"]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "[]\n", stderr: "No staged files to lint\n", exitCode: 0 });
});

test.concurrent(
  "with an oxlint config, bun lint --staged and --changed print the same messages, also on stderr",
  async () => {
    using repo = await repository({ ".oxlintrc.json": "{}", "a.js": before });
    expect(await bun(repo.root, ["lint", "--staged"])).toEqual({
      stdout: "",
      stderr: "No staged files to lint\n",
      exitCode: 0,
    });
    expect(await bun(repo.root, ["lint", "--changed=nothing"])).toEqual({
      stdout: "",
      stderr: 'error: "nothing" is not a branch, tag or commit in this repository\n',
      exitCode: 2,
    });
  },
);

describe.concurrent("bun lint --staged --fix still reports the problems in a partly staged file", () => {
  // One problem that can be fixed, and one that cannot.
  const staged = "let a = 1;\nexport { a };\nif (a) {\n}\n";
  const left = staged + "export const unstaged = 1;\n";
  const rules = ["--rule", "prefer-const: error", "--rule", "no-empty: error"];
  const refusal = (ext: string) => `error: partly.${ext} has both staged and unstaged changes, so it was not fixed\n`;

  async function partlyStaged(ext: string, more: Record<string, string> = {}) {
    const repo = await repository({ [`partly.${ext}`]: tidy, [`whole.${ext}`]: tidy, ...more });
    write(repo.root, `partly.${ext}`, staged);
    write(repo.root, `whole.${ext}`, before);
    await git(repo.root, "add", "-A");
    write(repo.root, `partly.${ext}`, left);
    return repo;
  }

  async function isUntouched(root: string, ext: string) {
    expect(read(root, `partly.${ext}`)).toBe(left);
    expect(await git(root, "show", `:partly.${ext}`)).toBe(staged);
    expect(await git(root, "show", `:whole.${ext}`)).toBe(after.lint);
    expect(await git(root, "status", "--porcelain")).toBe(`MM partly.${ext}\nM  whole.${ext}\n`);
  }

  test("in the default format", async () => {
    using repo = await partlyStaged("js");
    const { stdout, stderr, exitCode } = await bun(repo.root, ["lint", "--staged", "--fix", ...rules]);
    expect(stdout.match(/\b(prefer-const|no-empty)$|partly\.js:\d+:\d+$/gm)).toEqual([
      "prefer-const",
      "partly.js:1:5",
      "no-empty",
      "partly.js:3:8",
    ]);
    expect(stdout).toEndWith("\n\n2 problems (2 errors, 0 warnings)\n1 can be fixed with --fix\n");
    // That's the problem in whole.js.
    expect(stderr).toContain("Fixed 1 problem in 1 file\n");
    expect(stderr).toContain("Linted 2 files ");
    expect(stderr).toContain(refusal("js"));
    expect(exitCode).toBe(2);
    await isUntouched(repo.root, "js");
  });

  const typed = ["--type-aware", "--rule", "@typescript-eslint/await-thenable: error"];
  const oxlintrc = JSON.stringify({ rules: { "prefer-const": "error", "no-empty": "error" } });
  test.each([
    ["without a configuration file", "js", {}, rules],
    ["with a rule that needs types", "ts", { "tsconfig.json": "{}" }, [...rules, ...typed]],
    ["with a configuration of oxlint", "js", { ".oxlintrc.json": oxlintrc }, []],
  ] as const)("as JSON, %s", async (_, ext, more, flags) => {
    using repo = await partlyStaged(ext, more);
    const { stdout, stderr, exitCode } = await bun(repo.root, ["lint", "--staged", "--fix", "-f", "json", ...flags]);
    const printed = JSON.parse(stdout);
    if (Array.isArray(printed)) {
      const of = (name: string) => printed.find(it => it.filePath.endsWith(name));
      expect(of(`partly.${ext}`)).toMatchObject({
        messages: [{ ruleId: "prefer-const" }, { ruleId: "no-empty" }],
        errorCount: 2,
        fixableErrorCount: 1,
      });
      expect(of(`partly.${ext}`)).not.toHaveProperty("output");
      expect(of(`whole.${ext}`)).toMatchObject({ messages: [], output: after.lint });
    } else {
      expect(printed.diagnostics.map(it => `${it.filename}: ${it.code}`).sort()).toEqual([
        "partly.js: eslint(no-empty)",
        "partly.js: eslint(prefer-const)",
      ]);
    }
    expect(stderr).toContain(refusal(ext));
    expect(exitCode).toBe(2);
    await isUntouched(repo.root, ext);
  });

  test("a partly staged file with nothing to fix isn't rejected", async () => {
    using repo = await partlyStaged("js");
    const { stderr, exitCode } = await bun(repo.root, ["lint", "--staged", "--fix", "--rule", "no-empty: error"]);
    expect(stderr).not.toContain("unstaged");
    expect(exitCode).toBe(1);
    expect(read(repo.root, "partly.js")).toBe(left);
  });
});

test.concurrent("bun fmt --staged doesn't count a file it skips", async () => {
  using repo = await repository({ "partly.js": tidy, "whole.js": tidy, "tidy.js": tidy });
  const { root } = repo;
  for (const name of ["partly.js", "whole.js"]) write(root, name, before);
  write(root, "tidy.js", tidy + "\n" + tidy.replace("a", "b"));
  await git(root, "add", "-A");
  write(root, "partly.js", before + tidy.replace("a", "b"));
  const { stdout, stderr, exitCode } = await bun(root, ["fmt", "--staged"]);
  expect(stdout).toBe("whole.js\n");
  expect(stderr).toContain("Formatted 1 file, 1 unchanged ");
  expect(stderr).toContain("partly.js has both staged and unstaged changes, so it was not formatted\n");
  expect(exitCode).toBe(2);
});
