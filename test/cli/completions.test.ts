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
// command line followed by a literal TAB, and returning the terminal buffer
// up to the point where `expected` appears (success) or a BEL byte appears
// (zsh's "no match" signal — also a terminal state, just a failing one).
// This is poll-until-seen, not sleep-based, so it's fast in the common case
// and robust under CI load.
async function zshCompleteLine(cwd: string, line: string, expected: string): Promise<string> {
  // Outer zsh uses zpty to drive an inner interactive zsh, feeds setup
  // commands (each emitting a marker so we can synchronise on it), then
  // writes `<line><TAB>` and polls the pty buffer until `expected` or a
  // bell arrives.
  const script = [
    "emulate -L zsh",
    // Needed for `[0-9;]#m` (zsh "zero or more") in the ANSI-stripping glob.
    "setopt extendedglob",
    "zmodload zsh/zpty",
    // wait_for <needle> [timeout]: read zpty S until <needle> appears in
    // the accumulated buffer, with a poll interval. `zpty -r -t` on a
    // non-blocking pty returns immediately when there's no data, so we
    // sleep between polls to avoid pegging a core.
    `wait_for() {
        local needle="$1" timeout=\${2:-10} buf='' chunk
        local start=$SECONDS
        while (( SECONDS - start < timeout )); do
            if zpty -r -t S chunk 2>/dev/null; then
                buf+="$chunk"
                [[ "$buf" == *$needle* ]] && { printf '%s' "$buf"; return 0; }
            else
                sleep 0.02
            fi
        done
        printf '%s' "$buf"
        return 1
    }`,
    "zpty -b S zsh -i -f",
    // Set up the inner shell. `compinit -D` skips writing `~/.zcompdump`
    // so tests running concurrently never race on that file.
    "zpty -w S 'PS1=\"\"; autoload -Uz compinit && compinit -D; echo __INIT__'",
    "wait_for __INIT__ >/dev/null || { echo >&2 'inner zsh setup timed out'; exit 1; }",
    // `zpty -w` takes the argument verbatim as what to type at the inner
    // shell's prompt. We wrap the argument in single quotes (escaping
    // inner single quotes via the standard `'\''` dance) and sq() does
    // that for us. The inner `cd` and `source` commands then quote the
    // path values themselves.
    `zpty -w S ${sq("cd " + sq(cwd) + "; source " + sq(ZSH_COMPLETION) + "; echo __LOADED__")}`,
    "wait_for __LOADED__ >/dev/null || { echo >&2 'completion load timed out'; exit 1; }",
    "zpty -w S 'bindkey \"^I\" expand-or-complete; setopt no_always_last_prompt no_list_beep; echo __BOUND__'",
    "wait_for __BOUND__ >/dev/null || { echo >&2 'bindkey timed out'; exit 1; }",
    // Drain anything remaining from setup.
    "while zpty -r -t S junk 2>/dev/null; do :; done",
    // Literal tab triggers `expand-or-complete`. It either moves the
    // buffer past `<line>` (success) or rings the bell (BEL = 0x07) when
    // there's no match.
    `zpty -n -w S ${sq(line + "\t")}`,
    // Poll until either the expected substring or a BEL appears — that's
    // our "I'm done" signal, replacing a fixed sleep. 4s upper bound
    // keeps us well under bun:test's default 5s test timeout even under
    // CI load; the common case is <1s.
    //
    // We strip ANSI escape sequences from the accumulated buffer BEFORE
    // matching the needle because zsh's list-colors can insert colour
    // codes between individual characters of the completed token (e.g.
    // `foo\x1b[32m\x1b[39m-`), which would prevent a naive substring
    // check from matching.
    `local needle=${sq(expected)}`,
    `local out='' visible chunk start=$SECONDS`,
    "while (( SECONDS - start < 4 )); do",
    "    if zpty -r -t S chunk 2>/dev/null; then",
    '        out+="$chunk"',
    `        visible=\${out//\$'\\x1b'\\[[0-9;]#m/}`,
    // $'\a' is the BEL byte (0x07). Zsh rings this on a failed completion.
    `        [[ "$visible" == *$'\\a'* ]] && break`,
    '        [[ "$visible" == *$needle* ]] && break',
    "    else",
    "        sleep 0.02",
    "    fi",
    "done",
    "zpty -d S",
    `printf '%s' "$visible"`,
  ].join("\n");
  await using proc = Bun.spawn({
    cmd: ["zsh", "-c", script],
    env: bunEnv,
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`zsh driver exited with code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return stdout;
}

describe.skipIf(isWindows)("shell completions", () => {
  // Every test here spawns its own short-lived subprocess into its own
  // tempDir — no shared state, so we prefer concurrent per CLAUDE.md.
  describe.concurrent("bash (completions/bun.bash)", () => {
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

  describe.concurrent("zsh (completions/bun.zsh)", () => {
    // The bug in #30386 was reported against zsh on macOS; the fix mirrors
    // the bash one by adding a `*)` default branch to the `case $line[1]`
    // dispatch. The observable fix: typing `bun myscript.ts foo<TAB>`
    // now auto-completes to `foo-` (the common prefix of the matching
    // files). Before the fix, the buffer stays at `foo` and zsh rings
    // the bell (BEL byte in the pty output).
    test("completes files for `bun <script> <arg><TAB>`", async () => {
      if (!(await zshAvailable())) return;
      using dir = tempDir("bun-complete-zsh-30386", {
        "myscript.ts": "",
        "foo-file.txt": "",
        "foo-bar.txt": "",
      });
      const out = await zshCompleteLine(String(dir), "bun myscript.ts foo", "bun myscript.ts foo-");
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
      const out = await zshCompleteLine(String(dir), "bun run myscript.ts foo", "bun run myscript.ts foo-");
      expect(out).toContain("bun run myscript.ts foo-");
    });
  });

  describe.concurrent("syntax", () => {
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
