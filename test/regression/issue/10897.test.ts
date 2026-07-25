// https://github.com/oven-sh/bun/issues/10897
//
// `bun completions` (run by `bun upgrade` with IS_BUN_AUTO_UPDATE=true) only
// recognised an already-installed zsh snippet by its absolute path or the
// "# bun completions\n" marker. Users who reference the file via $HOME / ~ /
// ${HOME}, or whose marker line ends in CRLF, got a fresh hardcoded copy
// appended on every upgrade.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function runCompletions(home: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "completions", join(home, ".bun")],
    env: {
      ...bunEnv,
      HOME: home,
      ZDOTDIR: home,
      SHELL: "/bin/zsh",
      IS_BUN_AUTO_UPDATE: "true",
      BUN_INSTALL: undefined,
      XDG_DATA_HOME: undefined,
      XDG_CONFIG_HOME: undefined,
      fpath: undefined,
    } as Record<string, string | undefined>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function countBunSourceLines(zshrc: string): number {
  return (zshrc.match(/source\s+"[^"]*_bun"/g) ?? []).length;
}

test
  .skipIf(!isPosix)
  .each([
    ['[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"'],
    ['[ -s "${HOME}/.bun/_bun" ] && source "${HOME}/.bun/_bun"'],
    ['[ -s "~/.bun/_bun" ] && source "~/.bun/_bun"'],
    ['[ -s "$BUN_INSTALL/_bun" ] && source "$BUN_INSTALL/_bun"\n# bun completions\r'],
  ])("bun completions leaves existing zsh snippet alone: %s", async snippet => {
  const zshrcBefore = `export PATH="/usr/local/bin:$PATH"\n\n${snippet}\n`;
  using dir = tempDir("bun-completions-10897", {
    ".bun/.keep": "",
    ".zshrc": zshrcBefore,
  });
  const home = String(dir);

  const { stderr, exitCode } = await runCompletions(home);

  const zshrcAfter = readFileSync(join(home, ".zshrc"), "utf8");
  expect(countBunSourceLines(zshrcAfter)).toBe(1);
  expect(zshrcAfter).toBe(zshrcBefore);
  if (exitCode !== 0) expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test.skipIf(!isPosix)("bun completions still appends once on a fresh .zshrc", async () => {
  const zshrcBefore = 'export PATH="/usr/local/bin:$PATH"\n';
  using dir = tempDir("bun-completions-10897-fresh", {
    ".bun/.keep": "",
    ".zshrc": zshrcBefore,
  });
  const home = String(dir);

  const first = await runCompletions(home);
  const zshrcAfter = readFileSync(join(home, ".zshrc"), "utf8");
  expect(zshrcAfter).toContain("# bun completions");
  expect(countBunSourceLines(zshrcAfter)).toBe(1);
  if (first.exitCode !== 0) expect(first.stderr).toBe("");
  expect(first.exitCode).toBe(0);

  const second = await runCompletions(home);
  const zshrcAfter2 = readFileSync(join(home, ".zshrc"), "utf8");
  expect(zshrcAfter2).toBe(zshrcAfter);
  expect(second.exitCode).toBe(0);
});
