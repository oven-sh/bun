import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// vm.runInContext() reads about fifteen options on every call. `Identifier::fromString(vm, "name"_s)` looks the
// name up in the atom table each time, and for a name that no other code holds it also allocates the atom, inserts
// it, and removes and frees it again: about a quarter of the call before #42955. The option parsers take a name
// from NodeVMOptionNames (src/jsc/bindings/NodeVMOptionNames.h), which atomizes it once per VM, or from
// vm.propertyNames or builtinNames(vm).
const optionParsers = ["src/jsc/bindings/NodeVM.cpp", "src/jsc/bindings/NodeVMScript.cpp"];
const atomizesOnEveryLookup = /getIfPropertyExists\s*\([^;{}]*?Identifier::fromString\s*\(/g;

test("node:vm option parsers do not atomize an option name on every lookup", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const violations: string[] = [];
  let lookups = 0;
  for (const file of optionParsers) {
    // The whole file, so that a call broken over several lines is seen. Line comments go, newlines stay.
    const code = readFileSync(path.join(repoRoot, file), "utf8").replace(/\/\/.*$/gm, "");
    lookups += code.match(/getIfPropertyExists\s*\(/g)?.length ?? 0;
    for (const match of code.matchAll(atomizesOnEveryLookup)) {
      violations.push(`${file}:${code.slice(0, match.index).split("\n").length}`);
    }
  }
  // The parsers have about thirty lookups. None at all means they moved and this lint checks nothing.
  expect(lookups).toBeGreaterThan(10);
  expect(violations).toEqual([]);
});
