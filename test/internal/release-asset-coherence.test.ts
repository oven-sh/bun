// Guards the invariant that every zip name a download path can request
// (install.sh, install.ps1, the @oven/* npm packages, `bun upgrade`) is
// actually produced by the release pipeline. #34782 collapsed x64 to a single
// Nehalem binary with `-baseline` assets as rezipped aliases; a drift in any
// one of these files would 404 installs on release day.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { platforms } from "../../packages/bun-release/src/platform";

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

/**
 * Every `target` value install.sh can reach. Base values are parsed from the
 * literal `target=<os-arch>` assignments so a new platform case in install.sh
 * without a matching release asset fails here; the `-musl` / `-baseline` /
 * `-profile` suffix transforms are stable cross-cutting logic applied on top.
 */
function installShTargets(): Set<string> {
  const sh = readFileSync(join(repo, "src/runtime/cli/install.sh"), "utf8");
  const bases = new Set([...sh.matchAll(/^\s*target=([a-z][a-z0-9-]+)\s*$/gm)].map(m => m[1]));
  expect(bases.size).toBeGreaterThanOrEqual(5);
  expect(bases).toContain("linux-x64");

  const out = new Set<string>();
  for (const base of bases) {
    out.add(base);
    if (base.startsWith("linux-")) out.add(`${base}-musl`);
  }
  for (const t of [...out]) {
    // The AVX2 probe appends -baseline to *-x64* only.
    if (t.includes("-x64") && !t.startsWith("windows-")) out.add(`${t}-baseline`);
  }
  for (const t of [...out]) out.add(`${t}-profile`);
  return out;
}

describe("release asset coherence", () => {
  const assets = releaseAssetSet();

  test("upload-release.sh artifact list parsed", () => {
    expect(assets.size).toBeGreaterThanOrEqual(24);
    expect(assets.has("bun-linux-x64.zip")).toBe(true);
    expect(assets.has("bun-linux-x64-baseline.zip")).toBe(true);
  });

  test("install.sh targets all resolve to a release asset", () => {
    const targets = installShTargets();
    expect(targets.has("linux-x64-musl-baseline-profile")).toBe(true);
    const missing = [...targets].map(t => `bun-${t}.zip`).filter(n => !assets.has(n));
    expect(missing).toEqual([]);
  });

  test("install.ps1 targets all resolve to a release asset", () => {
    const want = ["bun-windows-x64.zip", "bun-windows-x64-baseline.zip", "bun-windows-aarch64.zip"];
    expect(want.filter(n => !assets.has(n))).toEqual([]);
  });

  test("packages/bun-release platform bins all resolve to a release asset", () => {
    // upload-npm.ts fetches `${bin}.zip` for every entry in `platforms`,
    // including `alias: true` entries, and extracts `${bin}/...` from it.
    const bins = platforms.map(p => p.bin);
    expect(bins.length).toBeGreaterThanOrEqual(14);
    const missing = bins.map(b => `${b}.zip`).filter(name => !assets.has(name));
    expect(missing).toEqual([]);
  });

  test("docs and npm READMEs do not describe baseline as a separate x64 build", () => {
    // The single x64 binary targets Nehalem (SSE4.2); AVX2 is runtime-dispatched.
    // Keeps installation/--compile docs and the npmjs.com-visible READMEs from
    // re-introducing the old "pick baseline if your CPU lacks AVX2" guidance.
    const files = [
      "docs/installation.mdx",
      "docs/bundler/executables.mdx",
      "packages/bun-release/npm/bun/README.md",
      "packages/bun-release/npm/@oven/bun-darwin-x64-baseline/README.md",
      "packages/bun-release/npm/@oven/bun-linux-x64-baseline/README.md",
      "packages/bun-release/npm/@oven/bun-windows-x64-baseline/README.md",
    ];
    const stale =
      /target the Haswell|require.{0,20}AVX2|without AVX2|do not support.{0,20}AVX2|modern is faster|baseline.{0,20}slower/i;
    const offenders: string[] = [];
    for (const file of files) {
      const doc = readFileSync(join(repo, file), "utf8");
      const m = doc.match(stale);
      if (m) offenders.push(`${file}: "${m[0]}"`);
    }
    expect(offenders).toEqual([]);
  });
});
