import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunRun, expectMaxObjectTypeCount, isWindows } from "harness";
import { join } from "node:path";
import vm from "node:vm";

// Regression: NodeVMScriptFetcher held its owner via JSC::Strong, forming a
// cycle (script -> m_source -> SourceProvider -> SourceOrigin ->
// RefPtr<NodeVMScriptFetcher> -> Strong<m_owner> -> script) that caused every
// vm.Script / vm.SourceTextModule / vm.compileFunction result to leak.

describe("node:vm NodeVMScriptFetcher leak", () => {
  test("vm.Script should not leak when references are dropped", async () => {
    const baseline = heapStats().objectTypeCounts.Script || 0;

    function iteration() {
      new vm.Script("1 + 1");
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "Script", baseline + 20);
  });

  test("vm.compileFunction should not leak when references are dropped", async () => {
    const baseline = heapStats().objectTypeCounts.FunctionExecutable || 0;

    function iteration() {
      vm.compileFunction("return 1");
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "FunctionExecutable", baseline + 50);
  });

  test("vm.SourceTextModule should not leak when references are dropped", async () => {
    const baseline = heapStats().objectTypeCounts.NodeVMSourceTextModule || 0;

    function iteration() {
      new vm.SourceTextModule("export const a = 1;");
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "NodeVMSourceTextModule", baseline + 20);
  });

  test("vm.Script with importModuleDynamically callback should not leak", async () => {
    const baseline = heapStats().objectTypeCounts.Script || 0;

    function iteration() {
      new vm.Script("1 + 1", {
        importModuleDynamically: () => {
          throw new Error("unreachable");
        },
      });
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "Script", baseline + 20);
  });

  // A callback that reaches the wrapper itself (a module linker cache) forms
  // callback -> wrapper -> source -> fetcher -> Weak<callback>; nothing external marks it.

  test("vm.Script with importModuleDynamically referencing the script should not leak", async () => {
    const baseline = heapStats().objectTypeCounts.Script || 0;

    function iteration() {
      const holder: { script?: vm.Script } = {};
      holder.script = new vm.Script("1 + 1", {
        importModuleDynamically: () => holder.script,
      });
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "Script", baseline + 20);
  });

  test("vm.SourceTextModule with importModuleDynamically referencing the module should not leak", async () => {
    const baseline = heapStats().objectTypeCounts.NodeVMSourceTextModule || 0;

    function iteration() {
      const cache = new Map<string, any>();
      const mod = new vm.SourceTextModule("export const a = 1;", {
        importModuleDynamically: specifier => cache.get(specifier),
      });
      cache.set("self", mod);
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "NodeVMSourceTextModule", baseline + 20);
  });

  test("vm.compileFunction with importModuleDynamically referencing the function should not leak", async () => {
    const baseline = heapStats().objectTypeCounts.FunctionExecutable || 0;

    function iteration() {
      const holder: { fn?: Function } = {};
      holder.fn = vm.compileFunction("return 1", [], {
        importModuleDynamically: () => holder.fn,
      });
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "FunctionExecutable", baseline + 50);
  });
});

// importModuleDynamically and its referrer live as long as code that can still import(), no longer.
describe("node:vm importModuleDynamically lifetime", () => {
  const fixture = join(import.meta.dir, "vm-import-callback-lifetime-fixture.js");
  const expected: Record<string, object> = {
    "leak-script": { alive: 0 },
    "leak-compileFunction": { alive: 0 },
    "leak-module": { alive: 0 },
    "alive-hostFunction": { contextCollected: true, result: "hooked", referrer: "Script" },
    "alive-compiledBeforeRun": { result: "hooked", referrer: "Script" },
    "alive-runInContext": { result: "hooked", referrer: "Script" },
    "alive-compileFunction": { result: "hooked", referrer: "function" },
    "alive-module": { result: "hooked", referrer: "SourceTextModule" },
    "freed-perScriptClosures": { alive: 0 },
    "stringFilename": { result: "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING" },
  };

  test.concurrent.each(Object.keys(expected))("%s", async scenario => {
    expect(await bunRun([fixture, scenario])).toSpawn(JSON.stringify(expected[scenario]));
  });

  // collectContinuously is very slow under Windows + ASAN in CI (see sourcetextmodule-link-gc.test.ts).
  test.concurrent
    .skipIf(isWindows)
    .each([
      "alive-hostFunction",
      "alive-compiledBeforeRun",
      "alive-runInContext",
      "alive-compileFunction",
      "alive-module",
    ])("%s while collecting continuously", async scenario => {
    const result = await bunRun([fixture, scenario], { BUN_JSC_collectContinuously: "1" });
    expect(result).toSpawn(JSON.stringify(expected[scenario]));
  });
});
