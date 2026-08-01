// Regression coverage for https://github.com/oven-sh/bun/issues/7805:
// `bun <path>` (no `run`) offered no file completions, and any runtime flag
// before the subcommand (`bun --hot run …`, `bun --watch …`) made every shell
// dispatch on the flag instead of the first positional word and complete
// nothing.
//
// `bun completions` writes the embedded completion script for the shell named
// by $SHELL to stdout when stdout is not a TTY, so the assertions run against
// the bytes that ship inside the binary.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

async function embeddedCompletions(shell: "fish" | "bash" | "zsh"): Promise<string> {
  using home = tempDir(`bun-completions-${shell}`, {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "completions"],
    env: { ...bunEnv, SHELL: `/bin/${shell}`, HOME: String(home), BUN_INSTALL: String(home) },
    cwd: String(home),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
  return stdout;
}

// The bash script uses `declare -A` (bash >= 4.0). macOS ships bash 3.2 as
// /bin/bash, so the functional probe needs a modern bash on PATH.
const bashMajor = (() => {
  if (isWindows || !Bun.which("bash")) return 0;
  try {
    const { stdout } = Bun.spawnSync({ cmd: ["bash", "-c", 'printf "%s" "${BASH_VERSINFO[0]}"'], env: bunEnv });
    return parseInt(stdout.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
})();

const fishBin = Bun.which("fish");
const zshBin = Bun.which("zsh");

const fixtureFiles = {
  "package.json": JSON.stringify({ name: "fixture", scripts: { myscript: "echo hi" } }),
  "src/index.ts": 'console.log("index");',
  "src/other.ts": 'console.log("other");',
};

describe.skipIf(isWindows)("shell completions: `bun <path>` and runtime flags (#7805)", () => {
  async function bashComplete(dir: string, line: string): Promise<string[]> {
    const probe =
      "source ./bun.bash\n" +
      "words=(" +
      line
        .trimEnd()
        .split(" ")
        .map(w => JSON.stringify(w))
        .join(" ") +
      ")\n" +
      (line.endsWith(" ") ? 'words+=("")\n' : "") +
      'COMP_WORDS=("${words[@]}")\n' +
      "COMP_CWORD=$(( ${#COMP_WORDS[@]} - 1 ))\n" +
      `COMP_LINE=${JSON.stringify(line)}\n` +
      "COMP_POINT=${#COMP_LINE}\n" +
      "COMPREPLY=()\n" +
      "_bun_completions\n" +
      "for w in \"${COMPREPLY[@]}\"; do printf '%s\\n' \"$w\"; done\n";
    await using proc = Bun.spawn({
      cmd: ["bash", "-c", probe],
      cwd: dir,
      env: { ...bunEnv, PATH: process.env.PATH },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout.split("\n").filter(Boolean);
  }

  test.concurrent.skipIf(bashMajor < 4)("bash: completes files for `bun <path>` with and without runtime flags", async () => {
    const script = await embeddedCompletions("bash");
    using dir = tempDir("bun-bash-completion-7805", { "bun.bash": script, ...fixtureFiles });

    for (const line of [
      "bun run src/",
      "bun src/",
      "bun --hot run src/",
      "bun run --watch src/",
      "bun --hot src/",
      "bun --watch src/",
      "bun --smol --hot src/",
      "bun --inspect src/",
    ]) {
      const reply = await bashComplete(String(dir), line);
      expect(reply, `line: ${JSON.stringify(line)}`).toContain("src/index.ts");
      expect(reply, `line: ${JSON.stringify(line)}`).toContain("src/other.ts");
    }

    // After a flag the subcommand list and `run` should still be offered.
    const afterFlag = await bashComplete(String(dir), "bun --hot ");
    expect(afterFlag).toContain("run");
    expect(afterFlag).toContain("install");
    expect(afterFlag).toContain("--watch");
  });

  test.concurrent.skipIf(bashMajor < 4)("bash: flag-taking options don't swallow the subcommand", async () => {
    const script = await embeddedCompletions("bash");
    using dir = tempDir("bun-bash-completion-7805b", { "bun.bash": script, ...fixtureFiles });

    const reply = await bashComplete(String(dir), "bun --cwd " + String(dir) + " run src/");
    expect(reply).toContain("src/index.ts");
  });

  test.concurrent.skipIf(bashMajor < 1)("bash: script passes bash -n", async () => {
    const script = await embeddedCompletions("bash");
    using dir = tempDir("bun-bash-n", { "bun.bash": script });
    await using proc = Bun.spawn({
      cmd: ["bash", "-n", "bun.bash"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!fishBin)("fish: completes files for `bun <path>` with and without runtime flags", async () => {
    const script = await embeddedCompletions("fish");
    using dir = tempDir("bun-fish-completion-7805", { "bun.fish": script, ...fixtureFiles });

    async function complete(line: string): Promise<string[]> {
      await using proc = Bun.spawn({
        cmd: [fishBin!, "--no-config", "-c", `source ./bun.fish; complete -C ${JSON.stringify(line)}`],
        cwd: String(dir),
        env: { ...bunEnv, PATH: process.env.PATH, HOME: String(dir) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(exitCode).toBe(0);
      return stdout
        .split("\n")
        .filter(Boolean)
        .map(l => l.split("\t")[0]);
    }

    for (const line of [
      "bun run src/",
      "bun src/",
      "bun --hot run src/",
      "bun run --watch src/",
      "bun --hot src/",
      "bun --watch src/",
    ]) {
      const reply = await complete(line);
      expect(reply, `line: ${JSON.stringify(line)}`).toContain("src/index.ts");
      expect(reply, `line: ${JSON.stringify(line)}`).toContain("src/other.ts");
    }

    // `bun --hot <TAB>` must still offer the subcommand position
    // (previously `--hot` was declared with `-r` and ate the next token).
    const afterHot = await complete("bun --hot ");
    expect(afterHot).toContain("run");

    // Subcommands other than `run` should not get entrypoint file completion.
    const afterAdd = await complete("bun add src/");
    expect(afterAdd).not.toContain("src/index.ts");
  });

  test.concurrent.skipIf(!fishBin)("fish: script is syntactically valid", async () => {
    const script = await embeddedCompletions("fish");
    using dir = tempDir("bun-fish-n", { "bun.fish": script });
    await using proc = Bun.spawn({
      cmd: [fishBin!, "--no-config", "-n", "bun.fish"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent.skipIf(!zshBin)("zsh: script is syntactically valid", async () => {
    const script = await embeddedCompletions("zsh");
    using dir = tempDir("bun-zsh-n", { "_bun": script });
    await using proc = Bun.spawn({
      cmd: [zshBin!, "-n", "_bun"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  // Functional zsh completion capture is non-trivial without zpty, so the zsh
  // coverage here is a structural assertion: the top-level `_arguments` call
  // must declare the boolean runtime flags so it skips over them when locating
  // the first positional word.
  test.concurrent("zsh: top-level `_arguments` declares runtime flags and offers files at the subcommand position", async () => {
    const script = await embeddedCompletions("zsh");
    const bun = script.slice(script.indexOf("\n_bun() {"));
    const topArguments = bun.slice(0, bun.indexOf("ret=0"));
    for (const flag of ["--hot", "--watch", "--smol", "--bun", "--preload", "--cwd"]) {
      expect(topArguments).toContain(`'${flag}[`);
    }
    // `bun <TAB>` (state=cmd) should offer real file completion, not just
    // `bun getcompletes j` (which only lists the current directory).
    expect(bun).toMatch(/"globbed-files:file:_files/);
    // An unknown first positional (a file or script path) should fall back to
    // `_files` rather than completing nothing.
    const argsDispatch = bun.slice(bun.indexOf("args)"), bun.indexOf("\n}"));
    expect(argsDispatch).toMatch(/\*\)\s*\n\s*_files\b/);
  });
});
