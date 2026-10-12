// `--staged` and `--changed` of `bun lint` and `bun format`.
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
import { join, relative, resolve } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// In place of the machine's own configuration.
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

/** A repository on `main`, with `files` in its first commit if there are any. */
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

/** The files of a run, from `root`. */
async function selected(root: string, cwd: string, args: string[], more?: Env) {
  const { stdout, stderr, exitCode } = await bun(cwd, [...args, "--list-files"], more);
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
  const names = stdout.split("\n").filter(it => it !== "");
  return names.map(it => relative(root, resolve(cwd, it)).replaceAll("\\", "/")).sort();
}

const commands = ["lint", "format"] as const;
// What `--fix` and `bun format` change, and what they make of it.
const [before, after] = ["export var a   = 1;\n", { lint: "export let a   = 1;\n", format: "export var a = 1;\n" }];
const writing = { lint: ["lint", "--fix", "--rule", "no-var: error"], format: ["format"] };
const tidy = "export const a = 1;\n";

describe.concurrent.each(commands)("bun %s", command => {
  test("--staged takes what is in the index and differs from HEAD", async () => {
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
    // Below the top: the arguments are from there, the names of git are not.
    expect(await selected(root, join(root, "sub"), [command, "--staged"])).toEqual(["sub/modified.js"]);
    expect(await selected(root, join(root, "sub"), [command, "--staged", ".."])).toEqual(all);
    // Whatever the repository says about how names are printed.
    await git(root, "config", "diff.relative", "true");
    await git(root, "config", "diff.renames", "copies");
    expect(await selected(root, join(root, "sub"), [command, "--staged", ".."])).toEqual(all);
  });

  test("--changed takes what differs from where the branch left the default branch, and what is new", async () => {
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
    // The default branch goes on.
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
    // What follows is a file.
    expect(await selected(root, root, [command, "--changed", "a.js", "d.js"])).toEqual(["a.js"]);
  });

  test("--changed prefers origin/HEAD, then main, then master, and says what it tried", async () => {
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

  test("--changed=<ref> takes one commit, and nothing that git could read as something else", async () => {
    using repo = await repository({ "a.js": tidy });
    const { root } = repo;
    write(root, "a.js", before);
    for (const written of ["nothing", "--output=written.txt", "-O", "HEAD..HEAD", "HEAD HEAD", "HEAD:a.js"]) {
      const { stdout, stderr, exitCode } = await bun(root, [command, `--changed=${written}`]);
      expect(stderr).toContain(`"${written}" is not a branch, a tag or a commit of this repository`);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 2 });
    }
    expect(existsSync(join(root, "written.txt"))).toBe(false);
    expect(read(root, "a.js")).toBe(before);
  });

  test("they only narrow what the arguments and the ignore files select", async () => {
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
      // A name that is mistyped is still one.
      const { exitCode } = await bun(root, [command, flag, "scr"]);
      expect(exitCode).toBe(2);
    }
    expect(without).toEqual(["lib/a.js", "src/a.js"]);
  });

  test("a run that is left without a file says so, and succeeds", async () => {
    using repo = await repository({ "a.js": before, "b.js": tidy });
    const { root } = repo;
    expect(await bun(root, [command, "--staged"])).toEqual({
      stdout: "",
      stderr: `No staged files to ${command}\n`,
      exitCode: 0,
    });
    expect(await bun(root, [command, "--changed"])).toEqual({
      stdout: "",
      stderr: `No changed files to ${command}\n`,
      exitCode: 0,
    });
    // There are some, and the argument is another file.
    write(root, "b.js", before);
    await git(root, "add", "b.js");
    const { stderr, exitCode } = await bun(root, [command, "--staged", "a.js"]);
    expect({ stderr, exitCode }).toEqual({ stderr: `No staged files to ${command}\n`, exitCode: 0 });
    expect(read(root, "a.js")).toBe(before);
  });

  test("a repository without a commit", async () => {
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

  test.each(["--staged", "--changed"])("%s where there is no repository, or no git", async flag => {
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

  test("flags that do not go together", async () => {
    using repo = await repository({ "a.js": tidy });
    const together = await bun(repo.root, [command, "--staged", "--changed"]);
    expect(together.stderr).toContain("--staged and --changed cannot be used together");
    expect(together.exitCode).toBe(2);
    const stdin = command === "lint" ? ["--stdin"] : ["--stdin-filepath", "a.js"];
    const piped = await bun(repo.root, [command, "--staged", ...stdin]);
    expect(piped.stderr).toContain(`--staged and ${stdin[0]} cannot be used together`);
    expect(piped.exitCode).toBe(2);
  });

  test("a link is not the file that it leads to, and a repository in the repository is another one", async () => {
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

  test("a file that is written and was staged as a whole is staged again", async () => {
    using repo = await repository({ "a.js": tidy, "sub/b.js": tidy, "c.js": tidy });
    const { root } = repo;
    // A name is no pattern: that one would stage c.js too.
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

  test("a file with staged and unstaged changes is not written", async () => {
    using repo = await repository({ "partly.js": tidy, "sub/partly.js": tidy, "whole.js": tidy, "tidy.js": tidy });
    const { root } = repo;
    for (const name of ["partly.js", "whole.js"]) write(root, name, before);
    write(root, "tidy.js", tidy + tidy.replace("a", "b"));
    await git(root, "add", "-A");
    const more = before + "export const unstaged = 1;\n";
    write(root, "partly.js", more);
    // It has nothing to write, so there is nothing to refuse.
    write(root, "tidy.js", tidy);

    const one = await bun(root, [...writing[command], "--staged"]);
    expect(one.stderr).toContain("partly.js has both staged and unstaged changes, so it was not written");
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
      /2 files have both staged and unstaged changes, so they were not written\n.*  \.\.\/partly\.js\n.*  partly\.js\n/,
    );
    expect(two.exitCode).toBe(2);
    expect(read(root, "sub/partly.js")).toBe(more);

    // A run that writes nothing has nothing to refuse.
    const looking = command === "lint" ? ["lint", "--rule", "no-var: error"] : ["format", "--check"];
    const three = await bun(root, [...looking, "--staged"]);
    expect(three.stderr).not.toContain("unstaged");
    expect(three.exitCode).toBe(1);
  });

  test.skipIf(isWindows)("in a hook, for the index of the commit", async () => {
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
    // The index of such a commit is a file of its own.
    write(root, "b.js", before);
    await git(root, "commit", "-q", "-a", "-m", "all");
    expect(await git(root, "show", "HEAD:b.js")).toBe(after[command]);
    expect(await git(root, "status", "--porcelain")).toBe("");
  });

  test.skipIf(isWindows)("git starts no program of the repository's configuration", async () => {
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

test.concurrent("bun lint --staged prints what its format prints for no file", async () => {
  using repo = await repository({ "a.js": before });
  const { stdout, stderr, exitCode } = await bun(repo.root, ["lint", "--staged", "-f", "json"]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "[]\n", stderr: "No staged files to lint\n", exitCode: 0 });
});
