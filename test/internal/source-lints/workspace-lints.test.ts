import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
const root = readFileSync(path.join(repoRoot, "Cargo.toml"), "utf8");

// The manifest of every crate of the workspace. `members` alone is not all of them: a path dependency under the root is
// a member without being listed.
const manifests = [
  ...new Set([
    ...[...(/^members = \[([^\]]*)\]/m.exec(root)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(it => `${it[1]}/Cargo.toml`),
    ...new Bun.Glob("src/**/Cargo.toml").scanSync(repoRoot),
  ]),
].sort();

function manifestsWithout(line: RegExp) {
  expect(manifests.length).toBeGreaterThan(100);
  return manifests.filter(manifest => !line.test(readFileSync(path.join(repoRoot, manifest), "utf8")));
}

// `[workspace.lints]` in the root Cargo.toml denies every warning, and much that rustc and clippy allow by default. It
// applies to a crate only if the crate says so. A crate that does not gets the defaults, under which the same findings
// are warnings, and `cargo clippy` passes.
test("every crate of the workspace has the lints of the workspace", () => {
  // A table of its own, like `[lints.rust]`, would replace them. Cargo refuses to have both.
  expect(manifestsWithout(/^\[lints\]\r?\nworkspace = true$/m)).toEqual([]);
});

// Every crate is an internal part of one binary. `publish = false` in `[workspace.package]` makes `cargo publish` refuse
// it, and like the lints it applies to a crate only if the crate says so.
test("no crate of the workspace can be published", () => {
  expect(root).toMatch(/^\[workspace\.package\]\n(?:[^\[\n].*\n)*publish = false$/m);
  expect(manifestsWithout(/^publish\.workspace = true$/m)).toEqual([]);
});

// rustc enforces each profile's `-Zallow-features` list, but only for the profile it is building with: a feature added
// to `[profile.dev]` alone passes `bun bd`, clippy and miri, then fails every release build. Nothing at all notices an
// entry whose last `#![feature(..)]` is gone.
test("both profiles allow exactly the nightly features that are in use", () => {
  const allowed = (profile: string) => {
    const table = new RegExp(
      String.raw`^\[profile\.${profile}\]\n(?:[^\[\n].*\n|\n)*?rustflags = \["""-Zallow-features=([^"]*)"""\]$`,
      "m",
    );
    return (table.exec(root)?.[1] ?? "").split(",").map(it => it.replace(/^\\\n\s*/, ""));
  };

  const used = new Set<string>();
  for (const file of new Bun.Glob("src/**/*.rs").scanSync(repoRoot)) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    if (!source.includes("feature(")) continue;
    const code = source.replace(/\/\/.*$/gm, "");
    for (const [, features] of code.matchAll(/#!\[(?:cfg_attr\([^\]]*?,\s*)?feature\(([^)]*)\)/g)) {
      for (const feature of features.split(",")) if (feature.trim()) used.add(feature.trim());
    }
  }
  expect(used.size).toBeGreaterThan(10);

  expect(allowed("release")).toEqual([...used].sort());
  expect(allowed("dev")).toEqual([...used].sort());
});
