import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The names of the builtin modules live in three hand-written tables:
//
// - builtinModuleNames in src/jsc/modules/NodeModuleModule.cpp is module.builtinModules.
// - builtinModuleNamesSortedLength in src/jsc/bindings/isBuiltinModule.cpp is what module.isBuiltin()
//   accepts (and what Bun.plugin refuses to override).
// - node_entry_only_prefix!() in src/resolve_builtins/HardcodedModule.rs marks the builtins that the module
//   loader resolves with the "node:" prefix only. Node lists those in builtinModules with the prefix.
//
// Nothing else compares them. A new module tends to land in the last two and not in the first: "node:test"
// was missing from builtinModules for over a year while isBuiltin("node:test") was true. This lint requires
// every name isBuiltin() accepts to be listed in builtinModules, unless notListed says why it is not.

// isBuiltin() names that builtinModules leaves out on purpose, with the reason. The lint fails while an entry
// here is listed after all, or is no longer accepted by isBuiltin().
const internalPlumbing =
  "internal plumbing, not a public module (#31831). isBuiltin() accepts it so that Bun.plugin refuses to override it.";
const notListed: Record<string, string> = {
  "bun:main": internalPlumbing,
  "bun:wrap": internalPlumbing,
  "node:quic": "experimental. Stock Node 26 builds do not list it either: QUIC is compiled out of them.",
};

const builtinModulesFile = "src/jsc/modules/NodeModuleModule.cpp";
const isBuiltinFile = "src/jsc/bindings/isBuiltinModule.cpp";
const resolverFile = "src/resolve_builtins/HardcodedModule.rs";
const root = path.resolve(import.meta.dir, "..", "..", "..");

// An entry that is commented out is not in the table.
const withoutCommentLines = (text: string) => text.replace(/^[ \t]*\/\/.*$/gm, "");

// The names of an ASCIILiteral table in their order, and the lines of it that are not one name each: a shape
// this does not know is reported, not skipped.
function asciiLiteralTable(file: string, name: string): { names: string[]; unread: string[] } {
  const source = readFileSync(path.join(root, file), "utf8");
  const table = new RegExp(String.raw`\b${name}\[\] = \{([^}]*)\};`).exec(source);
  if (table === null) throw new Error(`${file} no longer defines the table ${name}[]`);
  const names: string[] = [];
  const unread: string[] = [];
  for (const line of withoutCommentLines(table[1]).split("\n")) {
    const entry = /^\s*"([^"]+)"_s,?\s*(?:\/\/.*)?$/.exec(line);
    if (entry !== null) names.push(entry[1]);
    else if (line.trim() !== "") unread.push(line.trim());
  }
  if (names.length === 0) throw new Error(`${file}: the table ${name}[] has no "..."_s entries`);
  return { names, unread };
}

const listed = asciiLiteralTable(builtinModulesFile, "builtinModuleNames");
const accepted = asciiLiteralTable(isBuiltinFile, "builtinModuleNamesSortedLength");
const builtinModules = new Set(listed.names);
const isBuiltin = new Set(accepted.names);
const onlyPrefix = Array.from(
  withoutCommentLines(readFileSync(path.join(root, resolverFile), "utf8")).matchAll(
    /\bnode_entry_only_prefix!\("([^"]+)"\)/g,
  ),
  m => m[1],
);
if (onlyPrefix.length === 0) throw new Error(`${resolverFile} has no node_entry_only_prefix!() entries`);

test("every line of the two tables is one name, and no name is there twice", () => {
  const twice = (names: string[]) => names.filter((name, index) => names.indexOf(name) !== index);
  expect({
    [builtinModulesFile]: { unread: listed.unread, twice: twice(listed.names) },
    [isBuiltinFile]: { unread: accepted.unread, twice: twice(accepted.names) },
  }).toEqual({
    [builtinModulesFile]: { unread: [], twice: [] },
    [isBuiltinFile]: { unread: [], twice: [] },
  });
});

test(`${builtinModulesFile} lists every name ${isBuiltinFile} accepts, unless notListed says why not`, () => {
  const missing = [...isBuiltin].filter(name => !builtinModules.has(name) && !Object.hasOwn(notListed, name)).sort();
  expect(missing).toEqual([]);
});

test(`${isBuiltinFile} accepts every name ${builtinModulesFile} lists`, () => {
  const unknown = [...builtinModules].filter(name => !isBuiltin.has(name)).sort();
  expect(unknown).toEqual([]);
});

test(`${isBuiltinFile} accepts every prefix-only builtin of ${resolverFile} under its prefixed name`, () => {
  const unknown = onlyPrefix.filter(name => !isBuiltin.has(name)).sort();
  expect(unknown).toEqual([]);
});

test("notListed names only entries that isBuiltin() still accepts and builtinModules still leaves out", () => {
  const stale = Object.keys(notListed)
    .flatMap(name => {
      if (!isBuiltin.has(name)) return [`${name} is no longer in ${isBuiltinFile}; delete its entry`];
      if (builtinModules.has(name)) return [`${name} is listed in ${builtinModulesFile} now; delete its entry`];
      return [];
    })
    .sort();
  expect(stale).toEqual([]);
});
