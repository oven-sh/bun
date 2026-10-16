// Readers of a directory: `bun_sys::dir_iterator` (src/sys/lib.rs) and the node:fs copy
// (src/runtime/node/dir_iterator.rs).
//
// A directory can be removed after it was opened. Linux and FreeBSD then fail the read with ENOENT,
// and both iterators end the listing there, as readdir(3) in libc does: `next()` returns `Ok(None)`.
// For a reader that lists, or that deletes what it lists, that is right: nothing is left in a
// directory that was removed. It is wrong for a reader that copies, links, compares or mirrors what
// it lists. That reader would report a copy as complete, or two trees as equal, after one side
// disappeared. It must ask `dir_was_removed()` once the listing ends, and fail.
//
// Nothing in the types makes the author of a new reader choose, so this lint does. Every function
// that constructs an iterator is in dir-iterator-readers.inventory.json with one of these classes:
//
//   "removed-is-end"     lists, or deletes what it lists: a directory that was removed is an empty one
//   "asks"               copies, links, compares or mirrors: the function calls `dir_was_removed()`
//   "asks in <fn>"       the same, and the function `<fn>` of that file reads the iterator and asks
//   "ends-on-any-error"  already takes every failed read as the end (`while let Ok(Some(..))`)
//
// If this fails because you ADDED a reader: decide which class it is, write the code for that class,
// and add the function to the inventory by hand. A reader that is gone needs no change here.

import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/dir-iterator-readers.inventory.json";

// Where the iterators and their constructors are defined.
const DEFINITIONS = new Set(["src/sys/lib.rs", "src/runtime/node/dir_iterator.rs"]);

// Every spelling of a constructor. `DirIterator` is the one alias either module is imported under.
const CONSTRUCTORS =
  /\biterate_dir\s*\(|\b(?:dir_iterator|DirIterator)::iterate(?:::<[^>]*>)?\s*\(|\b(?:New)?WrappedIteratorW?(?:::<[^>]*>)?::init\s*\(/;
const ALIAS = /\bdir_iterator\s+as\s+(\w+)/g;
const KNOWN_ALIASES = new Set(["DirIterator"]);
// A constructor that is imported by its bare name is called in a spelling that CONSTRUCTORS does not see.
const BARE_IMPORT = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s[^;]*\b(?:dir_iterator::(?:\{[^}]*\b)?iterate\b|iterate_dir\b)/;
const FN = /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(\w+)/;

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

type Inventory = Record<string, Record<string, string>>;
/** file → function → the line of that function that constructs an iterator. */
const readers: Record<string, Record<string, string>> = {};
/** file → function → the source text of every function of that name in the file. */
const bodies: Record<string, Record<string, string>> = {};
const unknownAliases: string[] = [];
let scanned = 0;

for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (!source.startsWith("src/") || DEFINITIONS.has(source)) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const text = await file(abs).text();
  if (!text.includes("dir_iterator") && !text.includes("iterate_dir") && !text.includes("DirIterator")) continue;
  // Comment lines stay as empty lines, so that line numbers hold.
  const lines = text.split("\n").map(line => (/^\s*\/\//.test(line) ? "" : line));

  for (const match of lines.join("\n").matchAll(ALIAS)) {
    if (!KNOWN_ALIASES.has(match[1])) unknownAliases.push(`${source}: \`dir_iterator as ${match[1]}\``);
  }
  for (const line of lines) {
    if (BARE_IMPORT.test(line)) unknownAliases.push(`${source}: \`${line.trim()}\``);
  }

  // The functions of the file: name, first line, last line. A function with a body ends at the
  // first `}` that is indented as its `fn` is.
  const functions: { name: string; start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fn = FN.exec(lines[i]);
    if (!fn) continue;
    let end = i;
    while (end + 1 < lines.length && !/[{;]\s*$/.test(lines[end])) end++;
    if (!lines[end].trimEnd().endsWith(";")) {
      while (end + 1 < lines.length && !(lines[end].startsWith(fn[1] + "}") && end > i)) end++;
    }
    functions.push({ name: fn[2], start: i, end });
  }
  for (const { name, start, end } of functions) {
    (((bodies[source] ??= {})[name] ??= ""), (bodies[source][name] += lines.slice(start, end + 1).join("\n") + "\n"));
  }

  for (let i = 0; i < lines.length; i++) {
    if (!CONSTRUCTORS.test(lines[i])) continue;
    // The innermost function that holds the line.
    const holder = functions.findLast(fn => fn.start <= i && i <= fn.end);
    (readers[source] ??= {})[holder?.name ?? `<line ${i + 1}>`] = lines[i].trim();
  }
}

const inventory: Inventory = await file(INVENTORY).json();

// `bun ./test/internal/source-lints/dir-iterator-readers.test.ts --list` prints every reader with its class.
if (process.argv.includes("--list")) {
  for (const source of Object.keys(readers).sort()) {
    for (const name of Object.keys(readers[source]).sort()) {
      console.log(`${source}\t${name}\t${inventory[source]?.[name] ?? "?"}\t${readers[source][name]}`);
    }
  }
  process.exit(0);
}

const CLASS = /^(?:removed-is-end|ends-on-any-error|asks(?: in (\w+))?)$/;

describe("readers of a directory", () => {
  test("scans a non-empty set of tracked Rust sources and finds readers", () => {
    expect(scanned).toBeGreaterThan(0);
    expect(Object.keys(readers).length).toBeGreaterThan(0);
  });

  test("the iterators are imported under a known name", () => {
    expect(
      unknownAliases,
      "call the constructor as `dir_iterator::iterate(..)` or `bun_sys::iterate_dir(..)`, or teach this lint the new spelling",
    ).toEqual([]);
  });

  test("every function that constructs an iterator has a class", () => {
    const missing: string[] = [];
    for (const [source, byFunction] of Object.entries(readers)) {
      for (const [name, line] of Object.entries(byFunction)) {
        if (!CLASS.test(inventory[source]?.[name] ?? "")) missing.push(`${source}: fn ${name}: ${line}`);
      }
    }
    expect(
      missing,
      "A new reader of a directory. When the directory is removed while it is read, `next()` returns `Ok(None)`. " +
        "If the reader copies, links, compares or mirrors what it lists, it must ask `dir_was_removed()` once " +
        "the listing ends, and fail. Then add the function to dir-iterator-readers.inventory.json with its " +
        "class: see the header of this lint.",
    ).toEqual([]);
  });

  test('a function with the class "asks" calls dir_was_removed()', () => {
    const silent: string[] = [];
    for (const [source, byFunction] of Object.entries(inventory)) {
      for (const [name, cls] of Object.entries(byFunction)) {
        const asks = CLASS.exec(cls);
        if (!cls.startsWith("asks") || !asks || !readers[source]?.[name]) continue;
        const body = bodies[source]?.[asks[1] ?? name] ?? "";
        if (!body.includes("dir_was_removed()")) silent.push(`${source}: fn ${asks[1] ?? name}`);
      }
    }
    expect(silent, "this reader copies, links, compares or mirrors: it must ask `dir_was_removed()`").toEqual([]);
  });
});
