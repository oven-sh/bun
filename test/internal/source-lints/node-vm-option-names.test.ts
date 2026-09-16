import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// vm.runInContext() reads about fifteen options on every call. `Identifier::fromString(vm, "name"_s)` looks the
// name up in the atom table each time, and for a name that no other code holds it also allocates the atom, inserts
// it, and removes and frees it again: about a quarter of the call before #42955. The option parsers take a name
// from NodeVMOptionNames (src/jsc/bindings/NodeVMOptionNames.h), which atomizes it once per VM, or from
// vm.propertyNames or builtinNames(vm).
const optionParsers = ["src/jsc/bindings/NodeVM.cpp", "src/jsc/bindings/NodeVMScript.cpp"];
const atomizesOnEveryLookup = /getIfPropertyExists\s*\([^;]*Identifier::fromString\s*\(/;

test("node:vm option parsers do not atomize an option name on every lookup", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const violations: string[] = [];
  let lookups = 0;
  for (const file of optionParsers) {
    const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      const commentStart = line.indexOf("//");
      const code = commentStart === -1 ? line : line.slice(0, commentStart);
      if (code.includes("getIfPropertyExists(")) lookups++;
      if (atomizesOnEveryLookup.test(code)) violations.push(`${file}:${index + 1}`);
    });
  }
  // The parsers have about thirty lookups. None at all means they moved and this lint checks nothing.
  expect(lookups).toBeGreaterThan(10);
  expect(violations).toEqual([]);
});
