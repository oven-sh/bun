import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Both linkers take a package that is in place for installed. A pass that ends the process while a
// trusted package that it placed still has scripts to run leaves that package for the next install
// to skip. So these ways to end an install discard such packages first:
//
// - `Installer::end` (with `abort` and `abort_without`) and `PackageInstaller::abort`, with the
//   pass object in hand.
// - `InstallCtx::end_install`, from the script runner and `spawn_package_lifecycle_scripts`.
// - `RestoreManager::drop`, when the hoisted pass returns an error.
//
// This lint keeps other exits out of the code below. Call one of those instead. A directory helper
// that prints and exits has a `try_` form, for `abort_without`. For a new exit before the pass
// object exists, raise `before`: nothing is in place then.
//
// It does not see an exit in other code that a pass calls. `lockfile/Tree.rs` has two, which
// `check_tree_paths` reaches before the hoisted pass places a package. It does not cover an exit
// on another thread, a panic, or a failed allocation.
const exit = /\bGlobal::(?:exit|crash|raise_\w+)\s*\(|\.crash\s*\(|\bprocess::abort\s*\(/g;
const exitingHelper = /\b(?:get_cache_directory|get_temporary_directory|global_link_dir)\s*\(/g;

// Full-line comments do not count. `[ \t]*`, not `\s*`, keeps the line numbers.
function read(file: string) {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  return readFileSync(path.join(repoRoot, file), "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
}

// The matches of `pattern` in `code` from `start` up to `end`.
function sites(file: string, code: string, pattern: RegExp, start = 0, end = code.length) {
  return [...code.matchAll(pattern)]
    .filter(found => found.index >= start && found.index < end)
    .map(found => `${file}:${code.slice(0, found.index).split("\n").length}: ${found[0]}`);
}

// `pass`: the line that makes the pass object. A file without it is the pass object's own.
const passes: { file: string; pass?: RegExp; before?: number }[] = [
  { file: "src/install/isolated_install/Installer.rs" },
  { file: "src/install/PackageInstaller.rs" },
  { file: "src/install/isolated_install.rs", pass: /^ *let mut installer = store::Installer \{$/m, before: 5 },
  { file: "src/install/hoisted_install.rs", pass: /^ *let mut installer: PackageInstaller = /m, before: 2 },
];

test.each(passes)("$file has no exit of its own inside the pass", ({ file, pass, before = 0 }) => {
  const code = read(file);
  const start = pass ? code.search(pass) : 0;
  // -1: the pass object is made elsewhere now, and this lint checks nothing.
  expect(start).toBeGreaterThanOrEqual(0);
  expect(sites(file, code, exit, start)).toEqual([]);
  expect(sites(file, code, exit, 0, start)).toHaveLength(before);
  expect(sites(file, code, exitingHelper, start)).toEqual([]);
});

// These run inside a pass and hold no pass object. Code before `from` and after `to` does not.
test.each([
  {
    file: "src/install/lifecycle_script_runner.rs",
    from: "\nimpl<'a> LifecycleScriptSubprocess<'a> {",
    to: "\nimpl Drop for LifecycleScriptSubprocess<'_> {",
  },
  {
    file: "src/install/PackageManager/PackageManagerLifecycle.rs",
    from: "\n    pub fn spawn_package_lifecycle_scripts(",
    to: "\n    }\n",
  },
  { file: "src/install/PackageManager.rs", from: "\nfn ensure_temp_node_gyp_script_run(", to: "\n}\n" },
])("$file has no exit of its own where a pass runs", ({ file, from, to }) => {
  const code = read(file);
  const start = code.indexOf(from);
  const end = code.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  expect(sites(file, code, exit, start, end)).toEqual([]);
});
