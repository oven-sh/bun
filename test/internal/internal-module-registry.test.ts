import { expect, test } from "bun:test";
import { join } from "node:path";
import { createInternalModuleRegistry } from "../../src/codegen/internal-module-registry-scanner.ts";

// The builtin bundler (src/codegen/bundle-modules.ts) rewrites `require("<id>")`
// inside src/js through this registry. A `bun:` builtin must resolve by its
// public name, the same as `node:` ones, including the module that sorts first
// (registry id 0).
const registry = createInternalModuleRegistry(join(import.meta.dir, "../../src/js"));

function resolvedPath(specifier: string) {
  const code = registry.requireTransformer(specifier, "internal-for-testing.ts");
  const id = code.match(/__intrinsic__createInternalModuleById\((\d+)\/\*/);
  expect(id).not.toBeNull();
  return registry.moduleList[Number(id![1])];
}

test("bun: builtins resolve by name through the internal module registry", () => {
  expect(resolvedPath("bun:sqlite")).toBe("bun/sqlite.ts");
  expect(resolvedPath("bun:ffi")).toBe("bun/ffi.ts");
  expect(resolvedPath("node:fs")).toBe("node/fs.ts");
});

test("the module with registry id 0 resolves by name", () => {
  const first = registry.moduleList[0];
  expect(registry.internalRegistry.get(idOf(first))).toBe(0);
  expect(resolvedPath(idOf(first))).toBe(first);
});

function idOf(file: string) {
  const [dir, rest] = [file.slice(0, file.indexOf("/")), file.slice(file.indexOf("/") + 1)];
  const prefix = dir === "internal" ? "internal/" : dir + ":";
  return prefix + rest.replaceAll(".", "/").slice(0, -3);
}
