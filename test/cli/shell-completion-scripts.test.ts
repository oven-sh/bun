import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// `bun completions` writes the embedded completion script for the shell named
// by $SHELL to stdout when stdout is not a TTY. This lets us assert on the
// bytes that ship inside the binary (from completions/bun.{zsh,bash,fish}).
// HOME / BUN_INSTALL are cleared so the `install_bunx_symlink` step that runs
// before the piped-stdout write has nowhere outside the build tree to land.
async function emitCompletions(shell: "zsh" | "bash" | "fish"): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "completions"],
    env: {
      ...bunEnv,
      SHELL: `/bin/${shell}`,
      IS_BUN_AUTO_UPDATE: undefined,
      HOME: undefined,
      BUN_INSTALL: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);
  return stdout;
}

// completions/bun.bash uses `declare -A` (associative arrays, bash >= 4.0).
// macOS ships /bin/bash 3.2, so the functional probe can only run where a
// modern bash is on PATH.
const bashMajor = (() => {
  if (isWindows) return 0;
  try {
    const { stdout } = Bun.spawnSync({ cmd: ["bash", "-c", "echo ${BASH_VERSINFO[0]}"], env: bunEnv });
    return parseInt(stdout.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
})();

// `bun completions` is a no-op on Windows (PowerShell completions are not
// implemented), so these tests can only run on POSIX.
describe.skipIf(isWindows)("shell completion scripts", () => {
  test.concurrent("zsh: -i optspec has closing bracket inside the quote", async () => {
    // #31665: the line was `...=fallback'] \` (bracket outside the quote),
    // which zsh _arguments sees as a stray literal `]` argument.
    const script = await emitCompletions("zsh");
    expect(script).toContain("--install=fallback]' \\");
    expect(script).not.toContain("--install=fallback'] \\");
  });

  test.concurrent("zsh: _bun_add_param_package_completion prints history instead of executing it", async () => {
    // #34062: `$($inexact | grep ...)` runs the first history entry as a
    // command. It should be `$(print -l -- $inexact | grep ...)`.
    const script = await emitCompletions("zsh");
    expect(script).toContain("print -l -- $inexact | grep");
    expect(script).not.toContain("($($inexact | grep");
  });

  test.concurrent("bash: no reference to undeclared re_comp_word_script", async () => {
    // #28744 / #24847: ${re_comp_word_script} was never defined; under BSD
    // regex (macOS bash) `=~ <empty>` is rejected as "empty (sub)expression".
    const script = await emitCompletions("bash");
    expect(script).not.toContain("${re_comp_word_script}");
  });

  test.concurrent.skipIf(bashMajor < 1)("bash: script passes bash -n", async () => {
    const script = await emitCompletions("bash");
    using dir = tempDir("bun-bash-completion", { "bun.bash": script });
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

  // Drives _bun_completions directly. Skipped when PATH bash is < 4 (macOS
  // stock /bin/bash is 3.2 and rejects the script's `declare -A`).
  test.concurrent.skipIf(bashMajor < 4)("bash: `bun <entrypoint> <TAB>` still offers global flags", async () => {
    // Regression guard for the #24847 fix: the removed guard was always-true
    // under GNU regex, so the `replaced_script` assignment it protected has
    // always run. Dropping the arm outright would leave `bun somefile.js <TAB>`
    // with zero completions instead of the global flag list, so the fix makes
    // the block unconditional instead.
    const script = await emitCompletions("bash");
    using dir = tempDir("bun-bash-completion-run", {
      "bun.bash": script,
      "probe.sh":
        "source ./bun.bash\n" +
        'COMP_WORDS=(bun somefile.js "")\n' +
        "COMP_CWORD=2\n" +
        "COMPREPLY=()\n" +
        "_bun_completions\n" +
        'echo "count=${#COMPREPLY[@]}"\n' +
        "printf '%s\\n' \"${COMPREPLY[@]}\"\n",
    });
    await using proc = Bun.spawn({
      cmd: ["bash", "probe.sh"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    expect(lines[0]).toMatch(/^count=\d+$/);
    expect(Number(lines[0].slice("count=".length))).toBeGreaterThan(0);
    expect(lines).toContain("--help");
    expect(lines).toContain("--version");
    expect(exitCode).toBe(0);
  });

  test.concurrent("fish: install boolean flags include frozen-lockfile and descriptions line up", async () => {
    // #29364: frozen-lockfile was missing and dry-run's description was wrong.
    const script = await emitCompletions("fish");
    const flagsLine = script.split("\n").find(l => l.startsWith("set -l bun_install_boolean_flags "));
    const descLine = script.split("\n").find(l => l.startsWith("set -l bun_install_boolean_flags_descriptions "));
    expect(flagsLine).toBeDefined();
    expect(descLine).toBeDefined();

    const flags = flagsLine!.replace("set -l bun_install_boolean_flags ", "").trim().split(/\s+/);
    // Descriptions are a flat sequence of "..." literals separated by spaces.
    const descs = [...descLine!.matchAll(/"([^"]*)"/g)].map(m => m[1]);

    // The two parallel lists are zipped by index at runtime; length equality
    // alone cannot catch an insertion at the wrong position, so spot-check
    // the pairings this change touched as well.
    expect(descs.length).toBe(flags.length);
    expect(flags).toContain("frozen-lockfile");
    expect(descs[flags.indexOf("frozen-lockfile")]).toContain("lockfile");
    expect(descs[flags.indexOf("dry-run")]).toMatch(/dry run/i);
    expect(descs[flags.indexOf("global")]).toMatch(/global/i);
  });
});
