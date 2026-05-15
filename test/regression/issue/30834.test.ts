// https://github.com/oven-sh/bun/issues/30834
//
// Regression guard: `flake.nix` referenced `pkgs.darwin.apple_sdk.frameworks.*`
// attributes (CoreFoundation, CoreServices, Security), which depend on the
// `pkgs.darwin.apple_sdk_11_0` compatibility stub that nixpkgs-unstable has
// since removed. That made `nix develop` fail to evaluate on macOS with:
//
//   error: darwin.apple_sdk_11_0 has been removed as it was a legacy
//   compatibility stub; see
//   <https://nixos.org/manual/nixpkgs/stable/#sec-darwin-legacy-frameworks>
//   for migration instructions
//
// On current Darwin stdenvs these frameworks are provided automatically by
// stdenv and should not be listed as buildInputs. This test pins that
// contract: no `pkgs.darwin.apple_sdk` attribute references may reappear in
// our devShell config.
//
// (There's no Bun-runtime component to exercise — the failure is a Nix
// evaluation error in our dev-shell config — so this test parses the config
// files directly rather than spawning `nix`.)

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");

for (const name of ["flake.nix", "shell.nix"] as const) {
  test(`${name} does not reference removed \`darwin.apple_sdk.frameworks.*\` attrs`, () => {
    const src = readFileSync(join(repoRoot, name), "utf8");

    // Strip line comments so a comment explaining *why* the attrs were
    // removed doesn't itself trip the regex.
    const code = src.replace(/#[^\n]*/g, "");

    // Match the full attr path (`pkgs.darwin.apple_sdk` or
    // `pkgs.darwin.apple_sdk_11_0`) rather than just the leaf name so
    // unrelated identifiers that happen to contain "apple_sdk" (there
    // shouldn't be any, but be precise) are not flagged.
    const offenders = code.match(/\bpkgs\.darwin\.apple_sdk[\w.]*/g) ?? [];
    expect(offenders).toEqual([]);
  });
}
