// https://github.com/oven-sh/bun/issues/30335
//
// `bun completions` (invoked by `bun upgrade` with IS_BUN_AUTO_UPDATE=true)
// used to detect an already-installed completions snippet by looking only for
// the absolute `completions_path` string or the literal "# bun completions"
// marker comment. Users who rewrite the snippet to use `$HOME`/`${HOME}`/`~`
// so .zshrc is portable across machines, and drop the marker comment, would
// get a second hardcoded copy appended on every `bun upgrade`.
//
// Fix: additionally treat any existing reference to `/.bun/_bun` (the zsh
// completions filename under `.bun/`) as evidence that the user already has
// the snippet loaded in some form, so bun doesn't append its own copy.
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
      SHELL: "/bin/zsh",
      IS_BUN_AUTO_UPDATE: "true",
      // Force the zshrc-detection path: no ZDOTDIR, no $fpath override, no
      // XDG_DATA_HOME — so the command lands on $HOME/.zshrc and ~/.bun as
      // the completions dir (the exact path we pass in).
      ZDOTDIR: "",
      XDG_DATA_HOME: "",
      fpath: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

// Count `source "…_bun"` occurrences. The full snippet bun writes
// references the path twice on one line (in the `[ -s "…" ]` test and the
// `source "…"`), so each snippet contributes one match here. One match =
// user's own line is the only one. Two matches = bun appended a duplicate
// next to the user's hand-edited line — the 30335 bug.
function countBunSourceLines(zshrc: string): number {
  return (zshrc.match(/source\s+"?[^"\s]*\.bun\/_bun/g) ?? []).length;
}

test.if(isPosix)(
  "bun completions doesn't duplicate when .zshrc uses $HOME instead of a hardcoded path",
  async () => {
    const zshrcBefore = [
      "# some existing config",
      'export PATH="/usr/local/bin:$PATH"',
      "",
      '[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"',
      "",
    ].join("\n");
    using dir = tempDir("bun-completions-30335-home", {
      ".bun/.keep": "",
      ".zshrc": zshrcBefore,
    });
    const home = String(dir);

    const { exitCode } = await runCompletions(home);
    expect(exitCode).toBe(0);

    const zshrcAfter = readFileSync(join(home, ".zshrc"), "utf8");
    // No duplicate line appended — the $HOME reference is recognised.
    expect(countBunSourceLines(zshrcAfter)).toBe(1);
    // And the user's original line is untouched.
    expect(zshrcAfter).toBe(zshrcBefore);
  },
);

test.if(isPosix)(
  "bun completions doesn't duplicate for ~ or ${HOME} variants",
  async () => {
    for (const snippet of [
      '[ -s "~/.bun/_bun" ] && source "~/.bun/_bun"',
      '[ -s "${HOME}/.bun/_bun" ] && source "${HOME}/.bun/_bun"',
    ]) {
      const zshrcBefore = `export PATH="/usr/local/bin:$PATH"\n\n${snippet}\n`;
      using dir = tempDir("bun-completions-30335-variant", {
        ".bun/.keep": "",
        ".zshrc": zshrcBefore,
      });
      const home = String(dir);

      const { exitCode } = await runCompletions(home);
      expect(exitCode).toBe(0);

      const zshrcAfter = readFileSync(join(home, ".zshrc"), "utf8");
      expect(countBunSourceLines(zshrcAfter)).toBe(1);
      expect(zshrcAfter).toBe(zshrcBefore);
    }
  },
);

test.if(isPosix)(
  "bun completions still appends on a zshrc that doesn't reference _bun",
  async () => {
    // Sanity check: we haven't broken the fresh-install path. A .zshrc with
    // no existing bun snippet (and no marker comment) should still get one.
    const zshrcBefore = 'export PATH="/usr/local/bin:$PATH"\n';
    using dir = tempDir("bun-completions-30335-fresh", {
      ".bun/.keep": "",
      ".zshrc": zshrcBefore,
    });
    const home = String(dir);

    const { exitCode } = await runCompletions(home);
    expect(exitCode).toBe(0);

    const zshrcAfter = readFileSync(join(home, ".zshrc"), "utf8");
    expect(zshrcAfter).toContain("# bun completions");
    expect(countBunSourceLines(zshrcAfter)).toBe(1);
    // Running a second time must not append again.
    const { exitCode: exit2 } = await runCompletions(home);
    expect(exit2).toBe(0);
    const zshrcAfter2 = readFileSync(join(home, ".zshrc"), "utf8");
    expect(zshrcAfter2).toBe(zshrcAfter);
  },
);
