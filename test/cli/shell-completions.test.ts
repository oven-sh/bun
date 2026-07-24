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

async function embeddedCompletions(shell: "fish" | "bash" | "zsh"): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "completions"],
    env: { ...bunEnv, SHELL: `/bin/${shell}` },
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

describe.skipIf(isWindows)("shell completions", () => {
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
  });

  test("bash: includes runtime and per-command flags", async () => {
    const bash = await embeddedCompletions("bash");
    expect(bash).toMatch(/\bGLOBAL_OPTIONS_LONG="[^"]*--watch\b/);
    expect(bash).toMatch(/\bGLOBAL_OPTIONS_LONG="[^"]*--hot\b/);
    expect(bash).toMatch(/\bBUN_TEST_OPTIONS_LONG="[^"]*--update-snapshots\b/);
    expect(bash).toMatch(/\bBUN_TEST_OPTIONS_LONG="[^"]*--coverage\b/);
    expect(bash).toMatch(/\bBUN_INSTALL_OPTIONS_LONG="[^"]*--frozen-lockfile\b/);
    expect(bash).toMatch(/\bBUN_UPDATE_OPTIONS_LONG="[^"]*--latest\b/);
    expect(bash).toMatch(/\bBUN_BUILD_OPTIONS_LONG="[^"]*--compile\b/);
    expect(bash).toMatch(/\bBUN_UPGRADE_OPTIONS_LONG="[^"]*--canary\b/);
    for (const name of ["audit", "patch", "publish", "exec", "info", "outdated", "test"]) {
      expect(bash).toMatch(new RegExp(`\\bSUBCOMMANDS="[^"]*\\b${name}\\b`));
    }
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

  test("bash: script is syntactically valid", async () => {
    const bash = await embeddedCompletions("bash");
    using dir = tempDir("bun-bash-completion", { "bun.bash": bash });
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

  test("bash: functionally completes the #2503 cases", async () => {
    const bash = await embeddedCompletions("bash");
    const driver = `
test_complete() {
  local line="$1"; local expect="$2"
  COMP_WORDS=($line ""); COMP_CWORD=$(( \${#COMP_WORDS[@]} - 1 ))
  COMP_LINE="$line "; COMP_POINT=\${#COMP_LINE}; COMPREPLY=()
  _bun_completions
  if [[ " \${COMPREPLY[*]} " == *" $expect "* ]]; then
    echo "ok $line : $expect"
  else
    echo "MISSING $line : $expect"
  fi
}
test_complete "bun" "--watch"
test_complete "bun run" "--watch"
test_complete "bun test" "--watch"
test_complete "bun test" "--update-snapshots"
test_complete "bun install" "--frozen-lockfile"
test_complete "bun update" "--latest"
test_complete "bun" "run"
test_complete "bun" "test"
test_complete "bun pm" "pack"
`;
    using dir = tempDir("bun-bash-completion-run", {
      "bun.bash": bash,
      "driver.sh": `#!/bin/bash\nsource ./bun.bash\n${driver}`,
    });
    await using proc = Bun.spawn({
      cmd: ["bash", "driver.sh"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).not.toContain("MISSING");
    expect(stdout.split("\n").filter(l => l.startsWith("ok ")).length).toBe(9);
    expect(exitCode).toBe(0);
  });

  test("zsh: already had these flags (sanity check)", async () => {
    const zsh = await embeddedCompletions("zsh");
    expect(zsh).toContain("--watch[");
    expect(zsh).toContain("--update-snapshots[");
    expect(zsh).toContain("--frozen-lockfile[");
  });
});
