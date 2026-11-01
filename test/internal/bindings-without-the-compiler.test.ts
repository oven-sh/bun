import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const bindings = join(import.meta.dir, "../../src/jsc/bindings");
const header = readFileSync(join(bindings, "BunCompiledModules.h"), "utf8");
const source = readFileSync(join(bindings, "BunCompiledModules.cpp"), "utf8");

// No lane of CI builds Bun with `--aot=off`. There `vm.hasCompiledCode()` is a constant, so clang drops a call that stands behind
// `vm.hasCompiledCode() &&` and the link does not miss the function: until somebody writes the condition another way.
test("a Bun built without the compiler defines every function that BunCompiledModules.h declares", () => {
  const withoutTheCompiler = /^#else \/\/ ENABLE\(AOT\)$([^]*?)^#endif \/\/ ENABLE\(AOT\)$/m.exec(source)?.[1];
  if (withoutTheCompiler === undefined) throw new Error('BunCompiledModules.cpp has no "#else // ENABLE(AOT)"');

  const declaration = /^(?!inline |\/\/)[\w:<>*&, ]+?[ *&](\w+)\([^{}\n]*\);$/gm;
  const declared = Array.from(header.matchAll(declaration), match => match[1]!);
  expect(declared.length).toBeGreaterThan(30);
  expect(declared).toContain("compiledModulesRunInPlaceOfFiles");

  expect(declared.filter(name => !new RegExp(`[ *&]${name}\\(`).test(withoutTheCompiler))).toEqual([]);
});
