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
