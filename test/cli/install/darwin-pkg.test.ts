// Structural checks for the macOS .pkg installer sources in
// packages/bun-darwin-pkg. This test can't actually run pkgbuild (that's
// macOS-only and needs real bun binaries), but it guards against the kind
// of rot that would otherwise only surface at release time: lost executable
// bits, broken template substitution, malformed XML, or a postinstall that
// silently stopped setting BUN_INSTALL / PATH.

import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows } from "harness";
import { accessSync, constants, readFileSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join(import.meta.dir, "..", "..", "..", "packages", "bun-darwin-pkg");

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Skip on Windows: X_OK maps to F_OK there (so the executable-bit check is a
// no-op), and bash isn't guaranteed on PATH. The installer itself is
// macOS-only anyway — we only want one POSIX lane exercising these guards.
describe.skipIf(isWindows)("packages/bun-darwin-pkg", () => {
  test("build.sh and postinstall are executable and pass bash -n", async () => {
    const buildSh = join(pkgDir, "build.sh");
    const postinstall = join(pkgDir, "scripts", "postinstall");

    // pkgbuild requires the scripts it bundles to be executable; git tracks
    // the bit but it's easy to lose in a commit from a non-POSIX host.
    expect(isExecutable(buildSh)).toBe(true);
    expect(isExecutable(postinstall)).toBe(true);

    for (const script of [buildSh, postinstall]) {
      await using proc = Bun.spawn({
        cmd: ["bash", "-n", script],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }
  });

  test("distribution.xml.template is well-formed and substitutes cleanly", async () => {
    const template = readFileSync(join(pkgDir, "distribution.xml.template"), "utf8");

    // Exactly the three placeholders build.sh knows how to replace — no
    // stragglers that would leak an @FOO@ into the shipped installer.
    const placeholders = new Set([...template.matchAll(/@([A-Z_]+)@/g)].map(m => m[1]));
    expect([...placeholders].sort()).toEqual(["BUN_VERSION", "INSTALL_KB", "PKG_IDENTIFIER"]);

    const rendered = template
      .replaceAll("@BUN_VERSION@", "1.999.0")
      .replaceAll("@PKG_IDENTIFIER@", "sh.bun.bun")
      .replaceAll("@INSTALL_KB@", "123456");

    expect(rendered).not.toMatch(/@[A-Z_]+@/);

    // Sanity-check the bits Installer.app actually reads.
    expect(rendered).toContain("<installer-gui-script");
    expect(rendered).toContain("</installer-gui-script>");
    expect(rendered).toContain("<title>Bun</title>");
    expect(rendered).toContain('<welcome file="welcome.html"');
    expect(rendered).toContain('<conclusion file="conclusion.html"');
    expect(rendered).toContain('<background file="background.png"');
    expect(rendered).toContain('<background-darkAqua file="background-dark.png"');
    expect(rendered).toContain('hostArchitectures="arm64,x86_64"');
    expect(rendered).toContain(">bun-component.pkg</pkg-ref>");

    // Well-formedness: HTMLRewriter uses lol-html which handles XML-ish
    // input and will surface unbalanced tags as missing end() events.
    // Collect the element names we care about and make sure each one
    // opened exactly once.
    const seen: string[] = [];
    const rewriter = new HTMLRewriter();
    // lol-html lowercases tag names, hence background-darkaqua.
    const tags = [
      "installer-gui-script",
      "title",
      "welcome",
      "license",
      "conclusion",
      "background",
      "background-darkaqua",
      "pkg-ref",
    ];
    for (const tag of tags) {
      rewriter.on(tag, { element: () => void seen.push(tag) });
    }
    await rewriter.transform(new Response(rendered)).text();
    expect(seen.sort()).toEqual([...tags, "pkg-ref"].sort());
  });

  test("postinstall sets BUN_INSTALL, PATH, and /etc/paths.d", () => {
    const src = readFileSync(join(pkgDir, "scripts", "postinstall"), "utf8");

    // These are the user-visible promises the installer makes (see
    // welcome.html + docs/installation.mdx). Keep them honest.
    expect(src).toContain("/etc/paths.d/200-bun");
    // bash/zsh rc block
    expect(src).toContain('BUN_INSTALL="\\$HOME/.bun"');
    expect(src).toContain('PATH="\\$BUN_INSTALL/bin:\\$PATH"');
    // fish rc block — `--export` is load-bearing (without it the var is
    // shell-local and `bun add -g` can't see BUN_INSTALL).
    expect(src).toContain('set --export BUN_INSTALL "\\$HOME/.bun"');
    expect(src).toContain('set --export PATH "\\$BUN_INSTALL/bin" \\$PATH');
    expect(src).toContain("# bun (installed via .pkg)");
    expect(src).toContain('ln -sf bun "$BIN_DIR/bunx"');
    expect(src).toContain("completions");

    // postinstall runs as root but writes into the user's home directory;
    // make sure the drop-privileges write stays in place so a symlinked
    // rc file can't redirect the append into a root-owned target.
    expect(src).toMatch(/sudo -u "\$CONSOLE_USER" tee -a/);
  });

  test("welcome and conclusion pages embed the Bun logo", () => {
    for (const name of ["welcome.html", "conclusion.html"]) {
      const html = readFileSync(join(pkgDir, "resources", name), "utf8");
      // The logo is inlined as SVG so the pages render even if background
      // generation is skipped; check for one of its distinctive paint
      // attributes (the blush ellipses).
      expect(html).toContain("<svg");
      expect(html).toContain("#febbd0");
      expect(html).toContain("bun");
    }
  });
});
