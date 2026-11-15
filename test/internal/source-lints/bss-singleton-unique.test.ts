import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A `BSSList` or `BSSStringList` is a `static` of its module. Two declarations with the same name are
// two separate process-lifetime heaps, not two names for one store: a slice
// interned through one reads as "not ours" to the other's `as_interned()`, and the
// second store costs its own backing buffer (about 532 KiB for file names).
//
// The resolver once declared the file name store in both
// `src/resolver/fs.rs` (the readdir basename appender) and
// `src/resolver/lib.rs` (`FilenameStore::instance()`), so resolved paths and
// directory-entry names were interned into different stores. Rust cannot
// reject that at compile time: item names are only unique per module. A declare
// site is the single owner of its storage; every other user re-exports or imports the accessor.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout).
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// `static NAME: Once<BSSStringList>`, `static NAME: Once<Guarded<BSSList<T, N>>>`.
const STATIC = /(?<!')\bstatic\s+([A-Za-z_]\w*)\s*:.*\bBSS(?:String)?List\b/g;

const declarations = new Map<string, string[]>();
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const content = await file(abs).text();
  if (!/bss/i.test(content)) continue;
  // Strip `//` comments so prose mentions of a declaration do not count.
  const lines = content.split("\n").map(line => line.replace(/\/\/.*/, ""));
  for (const [index, line] of lines.entries()) {
    for (const [, name] of line.matchAll(STATIC)) {
      const sites = declarations.get(name) ?? [];
      sites.push(`${source}:${index + 1}`);
      declarations.set(name, sites);
    }
  }
}

test("scans the known bss singleton declare sites", () => {
  // Guards against the regex or the tracked/realpath filters over-firing and
  // leaving nothing to scan, which would make the uniqueness check vacuous.
  expect([...declarations.keys()]).toEqual(expect.arrayContaining(["DIRNAME_STORE", "FILENAME_STORE", "ENTRY_STORE"]));
});

test("every bss singleton name is declared exactly once", () => {
  const duplicates: string[] = [];
  for (const [name, sites] of [...declarations].sort(([a], [b]) => a.localeCompare(b))) {
    if (sites.length > 1) duplicates.push(`${name}: ${sites.join(", ")}`);
  }
  expect(duplicates).toEqual([]);
});
