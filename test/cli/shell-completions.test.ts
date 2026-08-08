// Tests that the shell completion scripts embedded in the binary
// (`bun completions` output) include the flags users actually use. These
// scripts are generated from completions/bun-cli.json by
// misctools/generate-shell-completions.ts and then embedded via include_bytes!
// in src/runtime/cli/shell_completions.rs.
//
// Regression coverage for https://github.com/oven-sh/bun/issues/2503:
// fish and bash were missing --watch, --update-snapshots, --frozen-lockfile
// and most other flags that had been added since the scripts were last
// hand-edited.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const fishBin = Bun.which("fish");
const bashBin = Bun.which("bash");

async function embeddedCompletions(shell: "fish" | "bash" | "zsh"): Promise<string> {
  // `bun completions` first tries to install a bunx symlink relative to the
  // executable and under $HOME/$BUN_INSTALL. Point those at a throwaway dir so
  // the test has no filesystem side effects.
  using home = tempDir("bun-completions-home", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "completions"],
    env: { ...bunEnv, SHELL: `/bin/${shell}`, HOME: String(home), BUN_INSTALL: String(home) },
    cwd: String(home),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

// Flags the original issue called out, plus a representative sample of the
// per-command flags that had drifted.
const expectedFishFlags: Array<[string, string]> = [
  ["run test", "watch"],
  ["run test", "hot"],
  ["run test", "smol"],
  ["run test", "inspect"],
  ["test", "update-snapshots"],
  ["test", "coverage"],
  ["test", "bail"],
  ["install i", "frozen-lockfile"],
  ["install i", "save-text-lockfile"],
  ["add a", "frozen-lockfile"],
  ["add a", "exact"],
  ["update", "latest"],
  ["build", "compile"],
  ["build", "minify"],
  ["upgrade", "canary"],
];

describe.concurrent.skipIf(isWindows)("shell completions", () => {
  test("fish: includes runtime and per-command flags", async () => {
    const fish = await embeddedCompletions("fish");
    for (const [subcmd, flag] of expectedFishFlags) {
      // Match a `complete -c bun ... -l '<flag>'` line scoped to (one of) the
      // given subcommand tokens.
      const tokens = subcmd.split(" ").map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const re = new RegExp(
        `^complete -c bun -n ['"][^'\\n"]*\\b(?:${tokens.join("|")})\\b[^'\\n"]*['"][^\\n]* -l '${flag}'`,
        "m",
      );
      expect(fish).toMatch(re);
    }
    // Subcommands that were missing entirely in the old fish file.
    for (const name of ["audit", "patch", "publish", "exec", "info"]) {
      expect(fish).toMatch(new RegExp(`^complete -c bun -n "__fish_use_subcommand" -a '${name}'`, "m"));
    }
    // pm subcommands.
    expect(fish).toContain("__fish_seen_subcommand_from pm");
    expect(fish).toMatch(/ -a '[^']*\bpack\b[^']*'/);
    // `complete -n '...'` conditions are evaluated at tab-press time, after
    // `set -l` variables from the sourced file have gone out of scope. Make
    // sure no condition string references one.
    expect(fish).not.toMatch(/complete -c bun[^\n]* -n '[^'\n]*\$bun_builtin_cmds\b/);
    // Per-command flags must be gated on the *first* positional only, so
    // `bun pm cache rm` doesn't pick up `bun remove`'s flags via the trailing
    // `rm` token.
    expect(fish).toMatch(/^function __bun_first_arg_in\b/m);
  });

  test("bash: includes runtime and per-command flags", async () => {
    const bash = await embeddedCompletions("bash");
    expect(bash).toMatch(/\bGLOBAL_OPTIONS="[^"]*--watch\b/);
    expect(bash).toMatch(/\bGLOBAL_OPTIONS="[^"]*--hot\b/);
    expect(bash).toMatch(/\bBUN_TEST_OPTIONS="[^"]*--update-snapshots\b/);
    expect(bash).toMatch(/\bBUN_TEST_OPTIONS="[^"]*--coverage\b/);
    expect(bash).toMatch(/\bBUN_INSTALL_OPTIONS="[^"]*--frozen-lockfile\b/);
    expect(bash).toMatch(/\bBUN_UPDATE_OPTIONS="[^"]*--latest\b/);
    expect(bash).toMatch(/\bBUN_BUILD_OPTIONS="[^"]*--compile\b/);
    expect(bash).toMatch(/\bBUN_UPGRADE_OPTIONS="[^"]*--canary\b/);
    for (const name of ["audit", "patch", "publish", "exec", "info", "outdated", "test"]) {
      expect(bash).toMatch(new RegExp(`\\bSUBCOMMANDS="[^"]*\\b${name}\\b`));
    }
    // Every ${BUN_*_OPTIONS} referenced in a case arm must have a matching
    // `local ...=` declaration, otherwise `set -u` users see "unbound variable".
    const declared = new Set([...bash.matchAll(/^\s*local (BUN_[A-Z_]+_OPTIONS)=/gm)].map(m => m[1]));
    const referenced = new Set([...bash.matchAll(/\$\{(BUN_[A-Z_]+_OPTIONS)\b/g)].map(m => m[1]));
    expect([...referenced].filter(name => !declared.has(name))).toEqual([]);
  });

  test.skipIf(!fishBin)("fish: script is syntactically valid", async () => {
    const fish = await embeddedCompletions("fish");
    using dir = tempDir("bun-fish-completion", { "bun.fish": fish });
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

  test.skipIf(!bashBin)("bash: script is syntactically valid", async () => {
    const bash = await embeddedCompletions("bash");
    using dir = tempDir("bun-bash-completion", { "bun.bash": bash });
    await using proc = Bun.spawn({
      cmd: [bashBin!, "-n", "bun.bash"],
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

  test.skipIf(!bashBin)("bash: functionally completes the #2503 cases", async () => {
    const bash = await embeddedCompletions("bash");
    const driver = `
test_has() {
  local line="$1"; local expect="$2"
  COMP_WORDS=($line ""); COMP_CWORD=$(( \${#COMP_WORDS[@]} - 1 ))
  COMP_LINE="$line "; COMP_POINT=\${#COMP_LINE}; COMPREPLY=()
  _bun_completions
  if [[ " \${COMPREPLY[*]} " == *" $expect "* ]]; then
    echo "ok $line : has $expect"
  else
    echo "MISSING $line : has $expect"
  fi
}
test_not() {
  local line="$1"; local expect="$2"
  COMP_WORDS=($line ""); COMP_CWORD=$(( \${#COMP_WORDS[@]} - 1 ))
  COMP_LINE="$line "; COMP_POINT=\${#COMP_LINE}; COMPREPLY=()
  _bun_completions
  if [[ " \${COMPREPLY[*]} " != *" $expect "* ]]; then
    echo "ok $line : not $expect"
  else
    echo "LEAKED $line : not $expect"
  fi
}
test_has "bun" "--watch"
test_has "bun run" "--watch"
test_has "bun test" "--watch"
test_has "bun test" "--update-snapshots"
test_has "bun install" "--frozen-lockfile"
test_has "bun update" "--latest"
test_has "bun" "run"
test_has "bun" "test"
test_has "bun pm" "pack"
test_has "bun --watch" "run"
test_has "bun --inspect test" "--update-snapshots"
test_has "bun --cwd . test" "--update-snapshots"
test_not "bun dev" "install"
test_not "bun dev" "--watch"
test_not "bun install" "--watch"
`;
    using dir = tempDir("bun-bash-completion-run", {
      "bun.bash": bash,
      "package.json": JSON.stringify({ scripts: { dev: "echo dev" } }),
      "driver.sh": `#!/bin/bash\nsource ./bun.bash\n${driver}`,
    });
    await using proc = Bun.spawn({
      cmd: [bashBin!, "driver.sh"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).not.toContain("MISSING");
    expect(stdout).not.toContain("LEAKED");
    expect(stdout.split("\n").filter(l => l.startsWith("ok ")).length).toBe(15);
    expect(exitCode).toBe(0);
  });

  test("zsh: already had these flags (sanity check)", async () => {
    const zsh = await embeddedCompletions("zsh");
    expect(zsh).toContain("--watch[");
    expect(zsh).toContain("--update-snapshots[");
    expect(zsh).toContain("--frozen-lockfile[");
  });
});
