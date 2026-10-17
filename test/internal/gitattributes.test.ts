// Guards the repo's .gitattributes against the gap reported in
// oven-sh/bun#39676: the old per-extension eol=lf list missed 1106 tracked
// files (.cjs, .sh, .snap, .pem, ...), so a default Windows clone
// (core.autocrlf=true) checked them out as CRLF and byte-exact fixtures broke.
//
// The tests replay the repo's .gitattributes in a scratch repo, so they do not
// need the test checkout itself to be a git worktree.
import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..", "..");
const gitattributes = await Bun.file(join(repoRoot, ".gitattributes")).text();

// Extensions the issue found unprotected, plus extension-less files.
const lfFiles: Record<string, string> = {};
for (const name of [
  "a.cjs",
  "a.cts",
  "a.sh",
  "a.snap",
  "a.snapshot",
  "a.pem",
  "a.txt",
  "a.yaml",
  "a.gyp",
  "a.idl",
  ".gitignore",
  ".env",
  "no-extension",
]) {
  lfFiles[name] = "line one\nline two\n";
}

// Real repo paths that are committed with CRLF and must stay byte-exact.
const crlfFiles: Record<string, string> = {
  "packages/bun-release/.gitignore": "dist\r\n",
  "src/runtime/cli/uninstall.ps1": "Write-Host 'bye'\r\n",
  "src/windows-app-info.rc": "// resource\r\n",
  "test/js/bun/io/hello-world.txt": "Hello World!\r\n",
  "test/js/bun/resolve/toml/toml-fixture.toml.txt": "a = 1\r\n",
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  await using proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: {
      ...bunEnv,
      // Point HOME/XDG_CONFIG_HOME into the scratch dir too: git's default
      // core.excludesFile ($HOME/.config/git/ignore) is not covered by
      // GIT_CONFIG_NOSYSTEM, and a host ignore for .env or *.pem would skip
      // those fixtures on `git add -A`.
      HOME: cwd,
      XDG_CONFIG_HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(cwd, "does-not-exist.gitconfig"),
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode, `git ${args.join(" ")} in ${cwd} exited with ${exitCode}:\n${stderr}`).toBe(0);
  return stdout;
}

async function makeScratchRepo(dir: string): Promise<void> {
  await git(dir, "init", "-q", "-b", "main");
  // autocrlf=false on add: the index gets the bytes exactly as written above.
  await git(dir, "-c", "core.autocrlf=false", "add", "-A");
  await git(dir, "-c", "core.autocrlf=false", "commit", "-q", "-m", "init");
}

// `git check-attr -a` prints one "<path>: <attr>: <value>" line per attribute
// that applies to the path. Returns the sorted "<attr>: <value>" parts.
async function attributesOf(dir: string, name: string): Promise<string[]> {
  const stdout = await git(dir, "check-attr", "-a", "--", name);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map(line => line.slice(`${name}: `.length))
    .sort();
}

test.concurrent("every text file checks out as LF under core.autocrlf=true", async () => {
  using dir = tempDir("gitattributes-lf", { ".gitattributes": gitattributes, ...lfFiles });
  await makeScratchRepo(String(dir));
  await git(String(dir), "-c", "core.autocrlf=true", "clone", "-q", ".", "clone");

  const clone = join(String(dir), "clone");
  for (const name of Object.keys(lfFiles)) {
    expect(await Bun.file(join(clone, name)).text(), name).toBe(lfFiles[name]);
  }
});

test.concurrent("files committed with CRLF keep their bytes", async () => {
  using dir = tempDir("gitattributes-crlf", { ".gitattributes": gitattributes, ...crlfFiles });
  await makeScratchRepo(String(dir));
  await git(String(dir), "-c", "core.autocrlf=true", "clone", "-q", ".", "clone");

  const clone = join(String(dir), "clone");
  for (const [name, expected] of Object.entries(crlfFiles)) {
    expect(await Bun.file(join(clone, name)).text(), name).toBe(expected);
  }

  // A renormalize must not rewrite them either.
  await git(clone, "-c", "core.autocrlf=true", "add", "--renormalize", ".");
  expect(await git(clone, "status", "--porcelain")).toBe("");
});

// The catch-all only pins eol. The per-extension lines also set the whitespace
// policy, and .cjs/.cts must get the same one as .js/.ts.
test.concurrent(".cjs and .cts carry the same attributes as .js and .ts", async () => {
  using dir = tempDir("gitattributes-siblings", { ".gitattributes": gitattributes });
  await git(String(dir), "init", "-q", "-b", "main");

  for (const [sibling, reference] of [
    ["a.cjs", "a.js"],
    ["a.cts", "a.ts"],
  ]) {
    const expected = await attributesOf(String(dir), reference);
    expect(expected, reference).toContain("eol: lf");
    expect(await attributesOf(String(dir), sibling), sibling).toEqual(expected);
  }
});
