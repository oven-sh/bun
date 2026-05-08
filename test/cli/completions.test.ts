import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import path from "node:path";

// Repo-relative paths to the completion scripts being exercised.
const BASH_COMPLETION = path.join(import.meta.dir, "..", "..", "completions", "bun.bash");
const ZSH_COMPLETION = path.join(import.meta.dir, "..", "..", "completions", "bun.zsh");

// Single-quote a string for embedding inside a shell single-quoted string.
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Spawn bash, source the completion script, drive `_bun_completions` with a
// simulated command line, and return the resulting COMPREPLY list.
async function bashComplete(cwd: string, words: string[], cwordIndex: number): Promise<string[]> {
  const compWords = words.map(sq).join(" ");
  const script = [
    "set +e",
    "shopt -s extglob",
    `source ${sq(BASH_COMPLETION)}`,
    `COMP_WORDS=(${compWords})`,
    `COMP_CWORD=${cwordIndex}`,
    `COMP_LINE=${sq(words.join(" "))}`,
    `COMP_POINT=\${#COMP_LINE}`,
    "COMPREPLY=()",
    "_bun_completions",
    // Emit each match on its own line prefixed with a sentinel so we can
    // distinguish it from stray diagnostic output.
    `for m in "\${COMPREPLY[@]}"; do printf 'COMP:%s\\n' "$m"; done`,
  ].join("\n");
  await using proc = Bun.spawn({
    cmd: ["bash", "-c", script],
    env: bunEnv,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`bash driver exited with code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return stdout
    .split("\n")
    .filter(l => l.startsWith("COMP:"))
    .map(l => l.slice("COMP:".length));
}

// Is zsh available? Only relevant for the zsh-specific coverage below;
// if unavailable the zsh tests silently pass (bash covers the same logic).
async function zshAvailable(): Promise<boolean> {
  try {
    await using proc = Bun.spawn({
      cmd: ["zsh", "-c", "exit 0"],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

// Drive zsh tab completion by spawning an embedded zsh via zpty, sending a
// command line followed by a literal TAB, and returning the resulting line
// from the inner shell's terminal buffer. Assertions check that the line
// contains the expected completion (e.g. a common-prefix auto-completion).
async function zshCompleteLine(cwd: string, line: string): Promise<string> {
  // We spawn zsh -c with a script that uses zpty to start ANOTHER
  // interactive zsh, feeds it setup commands (waiting for an echoed marker
  // between each stage so we never race), then writes `<line><TAB>` and
  // reads the terminal buffer back.
  const escapeSq = (s: string) => s.replace(/'/g, `'\\''`);
  const script = [
    "emulate -L zsh",
    "zmodload zsh/zpty",
    // wait_for <marker>: read zpty output until <marker> appears or 5s
    // elapses. This replaces sleep-based waits with deterministic
    // synchronisation on echoed markers.
    `wait_for() {
        local needle="$1" timeout=\${2:-5} buf='' chunk
        local start=$SECONDS
        while (( SECONDS - start < timeout )); do
            if zpty -r -t S chunk 0.05 2>/dev/null; then
                buf+="$chunk"
                [[ "$buf" == *$needle* ]] && return 0
            fi
        done
        return 1
    }`,
    "zpty -b S zsh -i -f",
    // Configure the inner shell, emitting a marker after each stage so
    // we know when it's done.
    "zpty -w S 'PS1=\"\"; autoload -Uz compinit && compinit -u; echo __INIT__'",
    "wait_for __INIT__ || { echo >&2 'inner zsh setup timed out'; exit 1; }",
    `zpty -w S 'cd ${escapeSq(cwd)}; source ${escapeSq(ZSH_COMPLETION)}; echo __LOADED__'`,
    "wait_for __LOADED__ || { echo >&2 'completion load timed out'; exit 1; }",
    "zpty -w S 'bindkey \"^I\" expand-or-complete; setopt no_always_last_prompt no_list_beep; echo __BOUND__'",
    "wait_for __BOUND__ || { echo >&2 'bindkey timed out'; exit 1; }",
    // Drain any remaining stdout now that we're past setup.
    "while zpty -r -t S junk 0.05 2>/dev/null; do :; done",
    // Literal tab at the end triggers `expand-or-complete`, which will
    // either auto-complete the common prefix or stay put (ring the bell).
    `zpty -n -w S '${escapeSq(line)}\t'`,
    // Give zsh a moment to process the TAB and emit its response. zpty
    // has no "done" signal, so we give it a fixed window to flush; the
    // inner zsh is already warm from compinit at this point, so 500ms
    // is plenty for a single completion lookup.
    "sleep 0.5",
    "local out=''",
    "local chunk",
    'while zpty -r -t S chunk 0.2 2>/dev/null; do out+="$chunk"; done',
    "zpty -d S",
    // Strip ANSI colour escape sequences emitted by list-colors.
    `printf '%s' "$out" | sed $'s/\\x1b\\\\[[0-9;]*m//g'`,
  ].join("\n");
  await using proc = Bun.spawn({
    cmd: ["zsh", "-c", script],
    env: bunEnv,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`zsh driver exited with code ${exitCode}`);
  }
  return stdout;
}

describe.skipIf(isWindows)("shell completions", () => {
  describe("bash (completions/bun.bash)", () => {
    // Regression for #30386: `bun myscript.ts foo<TAB>` did nothing. When
    // the first word after `bun` isn't a recognised subcommand, the
    // `case ${COMP_WORDS[1]} in ... *)` fallback in completions/bun.bash
    // never called into file completion, so positions 2+ got no files.
    test("completes files for `bun <script> <arg><TAB>`", async () => {
      using dir = tempDir("bun-complete-bash-30386", {
        "myscript.ts": "",
        "foo-file.txt": "",
        "foo-bar.txt": "",
        "bar.txt": "",
      });
      const matches = await bashComplete(String(dir), ["bun", "myscript.ts", "foo"], 2);
      expect(matches.sort()).toEqual(["foo-bar.txt", "foo-file.txt"]);
    });

    // Same shape, multiple positional args deep: the cwordIndex is 3 here
    // (`foo` at position 3), the first arg is still a script.
    test("completes files for `bun <script> <arg1> <arg2><TAB>`", async () => {
      using dir = tempDir("bun-complete-bash-30386-deep", {
        "myscript.ts": "",
        "foo-file.txt": "",
        "foo-bar.txt": "",
      });
      const matches = await bashComplete(String(dir), ["bun", "myscript.ts", "prev-arg", "foo"], 3);
      expect(matches.sort()).toEqual(["foo-bar.txt", "foo-file.txt"]);
    });

    // Guards against the first-arg path breaking — typing a partial script
    // name should still be valid input (no throw, reasonable output).
    test("does not throw on first-arg completion", async () => {
      using dir = tempDir("bun-complete-bash-30386-first", {
        "myscript.ts": "",
      });
      const matches = await bashComplete(String(dir), ["bun", "mysc"], 1);
      // First-arg behaviour is governed elsewhere (main_commands + scripts).
      // The only thing we care about here is that driving the completion
      // doesn't error out.
      expect(Array.isArray(matches)).toBe(true);
    });
  });

  describe("zsh (completions/bun.zsh)", () => {
    // The bug in #30386 was reported against zsh on macOS; the fix mirrors
    // the bash one by adding a `*)` default branch to the `case $line[1]`
    // dispatch. The observable fix: typing `bun myscript.ts foo<TAB>`
    // now auto-completes to `foo-` (the common prefix of the matching
    // files). Before the fix, the buffer stays at `foo`.
    test("completes files for `bun <script> <arg><TAB>`", async () => {
      if (!(await zshAvailable())) return;
      using dir = tempDir("bun-complete-zsh-30386", {
        "myscript.ts": "",
        "foo-file.txt": "",
        "foo-bar.txt": "",
      });
      const out = await zshCompleteLine(String(dir), "bun myscript.ts foo");
      expect(out).toContain("bun myscript.ts foo-");
    });

    // Regression guard: `bun run <script> <arg><TAB>` already worked
    // before this fix (via the `run)` branch's `other)` state). Assert it
    // still does after the new `*)` branch was added.
    test("completes files for `bun run <script> <arg><TAB>`", async () => {
      if (!(await zshAvailable())) return;
      using dir = tempDir("bun-complete-zsh-30386-run", {
        "myscript.ts": "",
        "foo-file.txt": "",
        "foo-bar.txt": "",
      });
      const out = await zshCompleteLine(String(dir), "bun run myscript.ts foo");
      expect(out).toContain("bun run myscript.ts foo-");
    });
  });

  describe("syntax", () => {
    // Catch-all: every shell completion script must parse cleanly.
    // Prevents future edits from breaking the scripts at source-load time.
    test("bun.bash parses", async () => {
      await using proc = Bun.spawn({
        cmd: ["bash", "-n", BASH_COMPLETION],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("bun.zsh parses", async () => {
      if (!(await zshAvailable())) return;
      await using proc = Bun.spawn({
        cmd: ["zsh", "-n", ZSH_COMPLETION],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });
});
