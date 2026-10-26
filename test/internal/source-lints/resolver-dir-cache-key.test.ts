import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The resolver has two directory caches for the whole process, `dir_cache` and `fs.entries`. Both store only a hash
// of the key. `Resolver::dir_cache_key` (src/resolver/resolver.rs) derives that key: the path without its trailing
// native separators. The walk of a miss takes each parent with `Dirname::dirname_native`. A lookup, a fill and a
// bust that derive a key in another way read and write another slot.
//
// `without_trailing_slash_windows_path` and `Dirname::dirname` are the other way. On POSIX they read a backslash as
// a separator, but it is a file name byte there. A key made with them for `/a/b\` was the key of `/a/b`: a failed
// open of `/a/b\` recorded `/a/b` as missing, and a lookup of `/a/b\` was answered with `/a/b`.
//
//   strings::without_trailing_slash_windows_path(dir)                    → Self::dir_cache_key(dir)
//   Dirname::dirname(key)                                                → Dirname::dirname_native(key)
//   resolver.bust_dir_cache(without_trailing_slash_windows_path(dir))    → resolver.bust_dir_cache(dir)
const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");

async function rustSources(directory: string): Promise<{ file: string; source: string }[]> {
  const sources: { file: string; source: string }[] = [];
  for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, directory) })) {
    const file = path.join(directory, rel).replaceAll("\\", "/");
    sources.push({ file, source: readFileSync(path.join(repoRoot, file), "utf8") });
  }
  return sources;
}

test("src/resolver derives the keys of its directory caches with dir_cache_key", async () => {
  // The calls that stay take a path that is not a key. `import_path_dir` takes the directory part of an import
  // path, for `load_as_file` and for the bust of an import path: `import("/a/b\\/c.js")` loads `/a/b/c.js`, as
  // node's ESM loader does. The second `Dirname::dirname` takes the directory of a tsconfig.json for its `extends`.
  const known = {
    "without_trailing_slash_windows_path(": { "src/resolver/resolver.rs": 1 },
    "Dirname::dirname(": { "src/resolver/resolver.rs": 2 },
  };

  const sources = await rustSources("src/resolver");
  const found: Record<string, Record<string, number>> = {};
  for (const call of Object.keys(known)) {
    found[call] = {};
    for (const { file, source } of sources) {
      const count = source.split("\n").filter(line => !/^\s*\/\//.test(line) && line.includes(call)).length;
      if (count > 0) found[call][file] = count;
    }
  }
  // Guard against repoRoot resolving wrong, which would make the check pass vacuously.
  expect(sources.length).toBeGreaterThan(5);
  expect(found).toEqual(known);
});

test("no caller strips a path before it busts the directory cache", async () => {
  const strip = /\bwithout_trailing_slash\w*\s*\(/;

  const sources = await rustSources("src");
  const found: string[] = [];
  for (const { file, source } of sources) {
    for (const call of source.matchAll(/\bbust_dir_cache\w*\s*\(/g)) {
      const before = source.slice(0, call.index);
      if (/\bfn\s+$/.test(before)) continue;

      const argsStart = call.index + call[0].length;
      let argsEnd = argsStart;
      for (let depth = 1; argsEnd < source.length; argsEnd++) {
        if (source[argsEnd] === "(") depth++;
        if (source[argsEnd] === ")" && --depth === 0) break;
      }
      const args = source.slice(argsStart, argsEnd);

      // The strip is in the argument list, or in the `let` of a local that the argument list names.
      const body = before.slice([...before.matchAll(/\bfn\s+\w+/g)].at(-1)?.index ?? 0);
      const locals = args.match(/(?<![.\w])[a-z_]\w*\b(?!\s*[(:])/g) ?? [];
      const stripped =
        strip.test(args) ||
        locals.some(local => new RegExp(`\\blet\\s+(?:mut\\s+)?${local}\\b[^=;]*=[^;]*?${strip.source}`).test(body));
      if (stripped) found.push(`${file}:${before.split("\n").length}`);
    }
  }
  expect(sources.length).toBeGreaterThan(1000);
  expect(found).toEqual([]);
});
