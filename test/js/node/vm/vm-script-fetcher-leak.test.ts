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
});
