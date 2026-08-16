import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";

// The lockfile is a set of parallel buffers addressed by two kinds of id:
// the package columns (`Lockfile.packages`) by `PackageID`, and
// `buffers.dependencies` / `buffers.resolutions` by `DependencyID`. Both ids
// are newtypes, and the buffers they address are `IdSlice` / `IdVec`, so a
// subscript takes the id itself and the compiler rejects the other kind. The
// escape hatch is `id.index()`, which turns an id back into a plain `usize`;
// it exists for bitsets and `packages.len()` checks. Writing
// `buffer[id.index()]` (or `buffer.get(id.index())`) instead of `buffer[id]`
// throws the type check away again, so this lint keeps those subscripts out
// of the install crate and the `bun pm` commands.

const root = path.resolve(import.meta.dir, "..", "..", "..");

function read(rel: string): Promise<string> {
  return file(path.join(root, rel)).text();
}

test("PackageID and DependencyID are newtypes, not integer aliases", async () => {
  const hooks = await read("src/install_types/resolver_hooks.rs");
  expect(hooks).toMatch(/^pub struct PackageID\(u32\);/m);
  expect(hooks).toMatch(/^pub struct DependencyID\(u32\);/m);
  expect(hooks).not.toMatch(/^pub type (?:PackageID|DependencyID)\b/m);
});

test("the package columns and the dependency buffers are indexed by id", async () => {
  const packageColumns = await read("src/install/lockfile/Package.rs");
  expect(packageColumns).toMatch(/trait PackageColumns\b[^{]*\bindexed by PackageID\s*\{/);

  const buffers = await read("src/install/lockfile/Buffers.rs");
  expect(buffers).toMatch(/^\s*pub dependencies: IdVec<DependencyID, Dependency>,/m);
  expect(buffers).toMatch(/^\s*pub resolutions: IdVec<DependencyID, PackageID>,/m);
});

// `x[id.index()]` (the id expression may itself contain a subscript, as in
// `x[ids[i].index()]`), except ranges (`raw[a.index()..b.index()]` is how a
// raw sub-range is spelled on purpose), and `x.get(id.index())`.
const SUBSCRIPT = /\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\.index\(\)\s*\]/g;
const GET = /\.get(?:_mut)?\(\s*[^()\n]*\.index\(\)\s*\)/g;

// Documented exceptions, each the one place a `usize` is genuinely the index:
const ALLOW: Record<string, number> = {
  // `Lockfile::package` is the row accessor over `MultiArrayList::get(usize)`;
  // everything else goes through it.
  "src/install/lockfile.rs": 1,
  // `Diff::generate`'s mapping holds positions within the old root package's
  // dependency list, read back into that sub-slice.
  "src/install/PackageManager/install_with_manager.rs": 1,
};

const scanRoots = ["src/install", "src/install_types", "src/runtime/cli"];

const sources: string[] = [];
for (const dir of scanRoots) {
  for (const rel of new Bun.Glob("**/*.rs").scanSync({ cwd: path.join(root, dir) })) {
    const abs = path.join(root, dir, rel);
    const source = path.relative(root, abs).replaceAll(path.sep, "/");
    // Count each file once under its canonical path (`src/cli` is a symlink
    // into `src/runtime/cli`).
    if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
    sources.push(source);
  }
}

const counts: Record<string, number> = {};
const offenders: string[] = [];
for (const source of sources.sort()) {
  // Only the pm commands in `src/runtime/cli` touch the lockfile.
  const content = await read(source);
  if (source.startsWith("src/runtime/cli/") && !content.includes("bun_install")) continue;
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const hits: { index: number; text: string }[] = [];
  for (const m of stripped.matchAll(SUBSCRIPT)) {
    if (!m[1].includes("..")) hits.push({ index: m.index, text: m[0] });
  }
  for (const m of stripped.matchAll(GET)) hits.push({ index: m.index, text: m[0] });
  for (const { index, text } of hits) {
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (ALLOW[source] ?? 0)) {
      const line = stripped.slice(0, index).split("\n").length;
      offenders.push(`${source}:${line}: \`${text.replace(/\s+/g, " ")}\` subscripts with a usize; index with the id`);
    }
  }
}

test("scans the install crate", () => {
  expect(sources.filter(s => s.startsWith("src/install/")).length).toBeGreaterThan(50);
});

test("id-indexed buffers are subscripted with the id, not id.index()", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  const actual = Object.fromEntries(Object.keys(ALLOW).map(source => [source, counts[source] ?? 0]));
  expect(actual).toEqual(ALLOW);
});
