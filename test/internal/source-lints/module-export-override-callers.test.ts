import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Module mocks and spies store to the export variables of loaded ES modules.
// Two export names, and two modules, can export one variable. A caller that
// reads the variable, stores its own value and later writes back what it read
// puts another caller's mock back: the mock is then in the module for the rest
// of the run, and in the next test file.
//
// `Bun::overrideExport()` in src/jsc/bindings/ModuleExportOverrides.cpp keeps
// what each variable had and who has stored to it, and `Bun::restoreExport()`
// takes no value to write back. So that file is the one place that calls the
// engine's `JSModuleNamespaceObject::overrideExportValue()` and
// `overrideExports()` for them.
//
// `vm.SyntheticModule#setExport()` (NodeVMSyntheticModule.cpp) sets the export
// of its own module and never gives a value back, so it keeps the plain store.
test("only Bun::overrideExport() stores to the export variable of a loaded module", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const engineStore = /(?:->|\.)\s*overrideExport(?:Value|s)\s*\(/;
  const callers: string[] = [];
  let scanned = 0;

  for await (const rel of new Glob("**/*.{h,hpp,cpp,cc,mm}").scan({ cwd: path.join(repoRoot, "src") })) {
    scanned++;
    if (engineStore.test(readFileSync(path.join(repoRoot, "src", rel), "utf8"))) {
      callers.push(path.join("src", rel).replaceAll("\\", "/"));
    }
  }

  // Guard against repoRoot resolving wrong (test file moved), which would make the check pass with nothing scanned.
  expect(scanned).toBeGreaterThan(0);
  expect(callers.sort()).toEqual([
    "src/jsc/bindings/ModuleExportOverrides.cpp",
    "src/jsc/bindings/NodeVMSyntheticModule.cpp",
  ]);
});
