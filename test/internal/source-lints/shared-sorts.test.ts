import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `slice::sort*` is compiled once for each type and closure that it is called with, several KB each: the 41 sorts of
// `bun format` were 228 KB of its 3.1 MB. `bun_collections::index_sort` sorts a list of indices with one function that
// is compiled once (`crate::sort` in src/format), at the cost of a call for each comparison.
//
//   items.sort() / items.sort_unstable()      → index_sort::sort_slice(&mut items)
//   items.sort_by(..) / sort_unstable_by(..)  → index_sort::sort_slice_by(&mut items, ..)
//   items.sort_by_key(..)                     → index_sort::sort_slice_by_key(&mut items, ..)
//   items.sort_by_cached_key(..)              → index_sort::sort_slice_by_cached_key(&mut items, ..)
test("the formatter sorts with the sorts that are compiled once", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const banned = /\.sort(?:_unstable)?(?:\(\)|_by(?:_key|_cached_key)?\()/;
  const directories = ["src/format", "src/lint/driver/fmt"];
  // Runs the tests of Prettier and oxfmt. Not in a release build.
  const isLinked = (file: string) => !file.startsWith("src/format/conformance/");

  const found: string[] = [];
  let scanned = 0;
  for (const directory of directories) {
    for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, directory) })) {
      const file = path.join(directory, rel).replaceAll("\\", "/");
      if (!isLinked(file)) continue;
      scanned++;
      readFileSync(path.join(repoRoot, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (!/^\s*\/\//.test(line) && banned.test(line)) found.push(`${file}:${index + 1}`);
        });
    }
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(200);
  expect(found).toEqual([]);
});
