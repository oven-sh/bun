import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// An `npm:` alias that bun knows sends a plain dependency with the name of the alias to the alias target. The
// dependency parser registers each alias it reads when its last argument is the package manager. A lockfile must
// not do that: bun can discard the lockfile after it read the row, and the alias then decides the next resolve.
// The caller that keeps the lockfile registers its rows (`Lockfile::record_dependency_row_aliases`).
//
// The loaders of bun.lock and bun.lockb and the package-lock.json migration hold no `&mut PackageManager`, so the
// compiler keeps them from it. These migrations hold one for other work. A new migration joins the list.
const migrations = ["src/install/yarn.rs", "src/install/pnpm.rs"];
const parserCall = /\b(?:[Dd]ependency::parse|parse_with_tag|parse_with_optional_tag)\s*\(/g;
// A clone of a dependency, of the overrides or of the catalogs takes the registry as an argument (`Clone::clone`
// takes none). The last two names are the alias map itself.
const otherWay =
  /\.clone_in\s*\(|\.clone_with_different_buffers\s*\(|\.clone\((?=\s*[^)\s])|\brecord_npm_alias\b|\bknown_npm_aliases\b/g;

/** The arguments of the call whose "(" is at `open`. */
function callArguments(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i++) {
    const char = code[i];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    if (depth === 0 || (depth === 1 && char === ",")) {
      const arg = code.slice(start, i).trim();
      if (arg) args.push(arg);
      start = i + 1;
    }
    if (depth === 0) break;
  }
  return args;
}

/** The number of parser calls in `source`, and each place that can register an alias, as "line: what". */
function registryUses(source: string) {
  // The whole file, so that a call broken over several lines is seen. Line comments go, newlines stay.
  const code = source.replace(/\/\/.*$/gm, "");
  const line = (index: number) => code.slice(0, index).split("\n").length;
  const uses: string[] = [];
  let parserCalls = 0;
  for (const match of code.matchAll(parserCall)) {
    parserCalls++;
    const registry = callArguments(code, match.index + match[0].length - 1).at(-1);
    if (registry !== "None") uses.push(`${line(match.index)}: ${registry}`);
  }
  for (const match of code.matchAll(otherWay)) uses.push(`${line(match.index)}: ${match[0]}`);
  return { parserCalls, uses };
}

test("registryUses finds each way to the alias registry", () => {
  const source = `Dependency::parse(name, Some(hash), &sliced.sub(&str[0..i]), None);
dependency::parse_with_tag(
    name, tag, &sliced, // Some(&mut *manager) in a comment
    Some(&mut *manager),
);
dep.clone_in(manager, buf, &mut builder);
dep.clone_with_different_buffers(manager, name_buf, version_buf, &mut builder);
old.overrides.clone(
    manager, old, this, &mut builder);
manager.record_npm_alias(hash, &version);
manager.known_npm_aliases.insert(hash, version);
let name = name.clone();`;
  expect(registryUses(source)).toEqual({
    parserCalls: 2,
    uses: [
      "2: Some(&mut *manager)",
      "6: .clone_in(",
      "7: .clone_with_different_buffers(",
      "8: .clone(",
      "10: record_npm_alias",
      "11: known_npm_aliases",
    ],
  });
});

test("a lockfile migration registers no alias", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const found = migrations.map(file => ({ file, ...registryUses(readFileSync(path.join(repoRoot, file), "utf8")) }));
  // The two migrations have eleven parser calls. None at all means they moved and this lint checks nothing.
  expect(found.reduce((sum, { parserCalls }) => sum + parserCalls, 0)).toBeGreaterThan(5);
  expect(found.flatMap(({ file, uses }) => uses.map(use => `${file}:${use}`))).toEqual([]);
});
