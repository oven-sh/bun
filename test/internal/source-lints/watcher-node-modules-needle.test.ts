import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A path that only holds the letters `node_modules` is not inside a package: a project folder named
// `node_modules-cleaner`, a file named `list-node_modules.js`. `--watch` and `--hot` did not watch such a file while
// the watcher searched paths for the bare letters. It asks for a path component.
test("the watcher does not search a path for the bare letters node_modules", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  // A search call whose needle is the literal, on one line or on several.
  const banned =
    /\b(?:contains|index_of|last_index_of|has_prefix|has_suffix|starts_with|ends_with)\w*\s*\((?:[^()]|\([^()]*\))*,\s*b"node_modules"\s*,?\s*\)/g;
  const hint =
    "the watcher's rule, Watcher::node_modules_scope(): file_is_inside_node_modules (the path of a file) or dir_is_or_is_inside_node_modules (the path of a directory)";

  const files = ["src/runtime/jsc_hooks.rs"];
  for (const directory of ["src/watcher", "src/jsc"]) {
    for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, directory) })) {
      files.push(path.join(directory, rel).replaceAll("\\", "/"));
    }
  }

  const found: string[] = [];
  for (const file of files) {
    // Full-line comments are blanked, with the newline kept for the line numbers.
    const source = readFileSync(path.join(repoRoot, file), "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
    for (const match of source.matchAll(banned)) {
      const line = source.slice(0, match.index).split("\n").length;
      found.push(`${file}:${line}: \`${match[0].replace(/\s+/g, " ")}\` → ${hint}`);
    }
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(files.length).toBeGreaterThan(100);
  expect(found).toEqual([]);
});
