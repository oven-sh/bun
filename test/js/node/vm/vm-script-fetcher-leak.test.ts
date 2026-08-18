import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { expectMaxObjectTypeCount } from "harness";
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

  // Regression: NodeVMScriptFetcher also held m_dynamicImportCallback via
  // JSC::Strong, so any importModuleDynamically closure that could reach the
  // resulting script/module (a common pattern in module linker caches) formed
  // an uncollectable cycle: script -> m_source -> SourceProvider -> SourceOrigin
  // -> RefPtr<NodeVMScriptFetcher> -> Strong<callback> -> closure -> script.

  test("vm.Script with importModuleDynamically referencing the script should not leak", async () => {
    const baseline = heapStats().objectTypeCounts.Script || 0;

    function iteration() {
      const holder: { script?: vm.Script } = {};
      holder.script = new vm.Script("1 + 1", {
        importModuleDynamically: () => {
          // Closure references the script via `holder`, forming a cycle through
          // the fetcher's callback reference.
          return holder.script;
        },
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
        importModuleDynamically: () => {
          return holder.fn;
        },
      });
    }
    for (let i = 0; i < 500; i++) iteration();

    await expectMaxObjectTypeCount(expect, "FunctionExecutable", baseline + 50);
  });

  test("vm.Script importModuleDynamically callback survives GC while script is alive", async () => {
    // After making the fetcher's callback Weak, the owning script must keep the
    // callback alive so that import() still works after a GC.
    let called = 0;
    const script = new vm.Script('import("kept").catch(() => {});', {
      importModuleDynamically: () => {
        called++;
        throw new Error("callback reached");
      },
    });

    Bun.gc(true);
    await Bun.sleep(0);
    Bun.gc(true);

    script.runInThisContext();
    await Bun.sleep(0);

    // If the Weak handle had been cleared, import() would have rejected with
    // ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING without invoking the callback.
    expect(called).toBe(1);
  });

  test("vm.compileFunction importModuleDynamically callback survives GC while function is alive", async () => {
    let called = 0;
    const fn = vm.compileFunction('return import("kept").catch(() => {});', [], {
      importModuleDynamically: () => {
        called++;
        throw new Error("callback reached");
      },
    });

    Bun.gc(true);
    await Bun.sleep(0);
    Bun.gc(true);

    await fn();

    expect(called).toBe(1);
  });
});
