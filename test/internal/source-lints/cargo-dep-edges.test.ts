import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";

// Every `bun_*::` path a crate's code names must have a matching dependency
// edge in that crate's Cargo.toml. cargo enforces this at compile time, but
// only for the crates a given change rebuilds — a dead-code sweep that prunes
// a "textually unreferenced" edge can race a PR that adds new uses of it, and
// both land green (#37301 removed bun_runtime's `bun_css` edge after being
// verified against a tree that predated #39229's `bun_css::StyleSheet` calls
// in pm_diff_normalize.rs; merged main then failed to build everywhere).
//
// This lint re-checks the pairing textually on every tree, so whichever PR
// merges second goes red on its own CI instead of breaking main.
//
// Matching is deliberately conservative:
// - only crate names that exist as workspace members count;
// - only `bun_x::` path uses count (`::bun_x::` absolute paths, the
//   macro-definition idiom that resolves at the expansion site, do not);
// - comments and string literals are stripped before matching.

const root = path.resolve(import.meta.dir, "..", "..", "..");

// Workspace member crates under src/*/ (the only layout the workspace uses;
// src/install/windows-shim is a standalone nested crate, excluded below).
interface Crate {
  name: string;
  dir: string; // repo-relative, posix separators
  deps: Set<string>;
}

const crates: Crate[] = [];
for (const manifest of new Bun.Glob("src/*/Cargo.toml").scanSync({ cwd: root })) {
  const dir = path.dirname(manifest).replaceAll(path.sep, "/");
  const toml = await file(path.join(root, manifest)).text();
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!name) continue;

  // Keys of every [*dependencies*] section: [dependencies],
  // [dev-dependencies], [build-dependencies], [target.'...'.dependencies].
  // `alias = { package = "real_name", ... }` declares `real_name`, but the
  // in-code path uses the alias, so record both.
  const deps = new Set<string>();
  let inDeps = false;
  for (const line of toml.split("\n")) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      inDeps = /dependencies/.test(section[1]);
      // `[dependencies.foo]` declares `foo` in the header itself.
      const headerDep = /(?:^|\.)dependencies\.([A-Za-z0-9_-]+)$/.exec(section[1]);
      if (headerDep) deps.add(headerDep[1].replaceAll("-", "_"));
      continue;
    }
    if (!inDeps) continue;
    // `name = ...`, `name.workspace = true`, `name.version = "..."`.
    const key = /^\s*([A-Za-z0-9_-]+)\s*[.=]/.exec(line);
    if (!key) continue;
    deps.add(key[1].replaceAll("-", "_"));
    const renamed = /\bpackage\s*=\s*"([^"]+)"/.exec(line);
    if (renamed) deps.add(renamed[1].replaceAll("-", "_"));
  }
  crates.push({ name, dir, deps });
}

const workspaceNames = new Set(crates.map(c => c.name));

// Tracked .rs files only (a `git stash` round-trip can leave stray files).
const trackedRs: string[] = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) throw new Error("git ls-tree failed");
  return r.stdout
    .toString()
    .split("\0")
    .filter(p => p.startsWith("src/") && p.endsWith(".rs"));
})();

// Nested standalone crates: their files belong to themselves, not to the
// src/*/ crate that contains them.
const nestedCrateDirs = ["src/install/windows-shim/"];

// Files mounted into a different crate's module tree via `#[path]`; their
// references resolve against the mounting crate's dependencies.
const mountedElsewhere: Record<string, string> = {
  "src/jsc/generated_classes_list.rs": "bun_runtime", // src/runtime/lib.rs `#[path] pub mod generated_classes_list`
};

function crateFor(rel: string): Crate | undefined {
  if (nestedCrateDirs.some(d => rel.startsWith(d))) return undefined;
  const mounted = mountedElsewhere[rel];
  if (mounted) return crates.find(c => c.name === mounted);
  return crates.find(c => rel.startsWith(c.dir + "/"));
}

/** Remove comments and string literals so prose mentions don't count. */
function stripNonCode(src: string): string {
  return src.replace(
    // raw strings, byte strings, plain strings, char literals, line and block
    // comments. The char-literal arm matches exactly one unit (`'x'`, `'\n'`,
    // `'\u{1F600}'`) so a lifetime's lone `'` can never open a match that
    // swallows code.
    /r#*"[\s\S]*?"#*|b?"(?:[^"\\]|\\[\s\S])*"|b?'(?:\\u\{[^}']*\}|\\[^\n]|[^'\\\n])'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    " ",
  );
}

// `bun_x::` as a path head. The lookbehind rejects `::bun_x::` (absolute
// paths inside macro definitions resolve where the macro expands) and
// identifier tails like `other_bun_x::`.
const PATH_USE = /(?<![\w:])(bun_[a-z0-9_]+)(?=::)/g;

// A `bun_*` name can be bound locally instead of naming the crate:
//   extern crate bun_core as bun_output;   (crate-wide rename)
//   use bun_core::output as bun_output;    (module alias)
//   pub mod bun_spawn { ... }              (local module shadows the crate)
// Any such binding anywhere in a crate takes that name out of this lint for
// the whole crate; rustc resolves those for real.
const LOCAL_BINDING = /\b(?:mod\s+(bun_[a-z0-9_]+)\b(?!\s*::)|as\s+(bun_[a-z0-9_]+)\b)/g;

// The scan runs at module scope (like the other lints here): per-test
// timeouts then cover only the assertion, not the repo walk, which is slow
// under a debug + ASAN build.
const byCrate = new Map<Crate, { files: string[]; shadowed: Set<string> }>();
const stripped = new Map<string, string>();

for (const rel of trackedRs) {
  const crate = crateFor(rel);
  if (!crate) continue;
  const code = stripNonCode(await file(path.join(root, rel)).text());
  stripped.set(rel, code);
  let entry = byCrate.get(crate);
  if (!entry) byCrate.set(crate, (entry = { files: [], shadowed: new Set() }));
  entry.files.push(rel);
  for (const m of code.matchAll(LOCAL_BINDING)) entry.shadowed.add(m[1] ?? m[2]);
}

const violations: string[] = [];
for (const [crate, { files, shadowed }] of byCrate) {
  for (const rel of files) {
    const seen = new Set<string>();
    for (const m of stripped.get(rel)!.matchAll(PATH_USE)) {
      const used = m[1];
      if (seen.has(used)) continue;
      seen.add(used);
      if (used === crate.name) continue;
      if (!workspaceNames.has(used)) continue;
      if (crate.deps.has(used)) continue;
      if (shadowed.has(used)) continue;
      violations.push(`${rel}: uses \`${used}::\` but ${crate.dir}/Cargo.toml has no \`${used}\` dependency`);
    }
  }
}

test("every bun_*:: reference has a Cargo.toml dependency edge", () => {
  expect(violations).toEqual([]);
});
