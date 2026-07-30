// Guards the invariant that every zip name a download path can request
// (install.sh, install.ps1, the @oven/* npm packages, `bun upgrade`) is
// actually produced by the release pipeline. #34782 collapsed x64 to a single
// Nehalem binary with `-baseline` assets as rezipped aliases; a drift in any
// one of these files would 404 installs on release day.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..");

/** Set of `<name>.zip` files the release step uploads to the GitHub release. */
function releaseAssetSet(): Set<string> {
  const sh = readFileSync(join(repo, ".buildkite/scripts/upload-release.sh"), "utf8");

  // `local artifacts=( ... )` holds the primary zip names CI produces.
  const listMatch = sh.match(/local artifacts=\(([\s\S]*?)\)/);
  if (!listMatch) throw new Error("upload-release.sh: artifacts=() block not found");
  const assets = new Set<string>();
  for (const m of listMatch[1].matchAll(/(bun-[A-Za-z0-9_-]+\.zip)/g)) assets.add(m[1]);

  // `alias_baseline_artifact` rezips each primary x64 zip under a `-baseline`
  // name with the inner directory renamed to match; include those.
  const aliasBody = sh.match(/function alias_baseline_artifact\b[\s\S]*?\n {2}\}/);
  if (!aliasBody) throw new Error("upload-release.sh: alias_baseline_artifact() not found");
  for (const m of aliasBody[0].matchAll(/echo "(bun-[A-Za-z0-9_-]+\.zip)"/g)) assets.add(m[1]);

  return assets;
}

describe("release asset coherence", () => {
  const assets = releaseAssetSet();

  test("upload-release.sh artifact list parsed", () => {
    expect(assets.size).toBeGreaterThanOrEqual(24);
    expect(assets.has("bun-linux-x64.zip")).toBe(true);
    expect(assets.has("bun-linux-x64-baseline.zip")).toBe(true);
  });

  test("install.sh targets all resolve to a release asset", () => {
    // Every `target=...` assignment the script can reach, expanded over the
    // platform cases plus the avx2-miss `-baseline` and `debug-info` `-profile`
    // suffix paths. Keep this list literal so adding a case to install.sh
    // without a matching release asset fails here.
    const want = [
      "darwin-x64",
      "darwin-x64-baseline",
      "darwin-aarch64",
      "linux-x64",
      "linux-x64-baseline",
      "linux-x64-musl",
      "linux-x64-musl-baseline",
      "linux-aarch64",
      "linux-aarch64-musl",
      "windows-x64",
      "windows-aarch64",
    ];
    const missing: string[] = [];
    for (const t of want) {
      for (const suffix of ["", "-profile"]) {
        const name = `bun-${t}${suffix}.zip`;
        if (!assets.has(name)) missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  test("install.ps1 targets all resolve to a release asset", () => {
    const want = ["bun-windows-x64.zip", "bun-windows-x64-baseline.zip", "bun-windows-aarch64.zip"];
    expect(want.filter(n => !assets.has(n))).toEqual([]);
  });

  test("packages/bun-release platform bins all resolve to a release asset", () => {
    // upload-npm.ts fetches `${bin}.zip` for every entry in `platforms`,
    // including `alias: true` entries, and extracts `${bin}/...` from it.
    const src = readFileSync(join(repo, "packages/bun-release/src/platform.ts"), "utf8");
    const bins = [...src.matchAll(/bin:\s*"(bun-[A-Za-z0-9_-]+)"/g)].map(m => m[1]);
    expect(bins.length).toBeGreaterThanOrEqual(14);
    const missing = bins.map(b => `${b}.zip`).filter(name => !assets.has(name));
    expect(missing).toEqual([]);
  });

  test("docs do not claim x64 requires AVX2/Haswell", () => {
    // The single x64 binary targets Nehalem (SSE4.2); AVX2 is runtime-dispatched.
    // Keeps installation and --compile docs from re-introducing the old
    // "pick baseline if your CPU lacks AVX2" guidance.
    for (const file of ["docs/installation.mdx", "docs/bundler/executables.mdx"]) {
      const doc = readFileSync(join(repo, file), "utf8");
      expect(doc).not.toMatch(/target the Haswell/i);
      expect(doc).not.toMatch(/require.{0,20}AVX2/i);
      expect(doc).not.toMatch(/modern is faster/i);
    }
  });
});
