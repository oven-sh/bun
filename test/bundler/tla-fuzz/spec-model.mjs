// Reference model: a line-by-line transliteration of ECMA-262 (2026 draft) Cyclic Module Record
// evaluation, emitted together with the graph's module bodies as ONE file.
// Purpose: (1) check engines against the spec text, (2) upper bound for "emulate the loader".
import { bodyLines, hasTLA, names, namespace } from "./gen.mjs";

export const SPEC_RUNTIME = String.raw`
const EMPTY = Symbol("empty"), UNSET = Symbol("unset"), DONE = Symbol("done");
let moduleAsyncEvaluationCount = 0;
const newCap = () => { let c = {}; c.promise = new Promise((res, rej) => { c.resolve = res; c.reject = rej; }); return c; };
const Module = (id, hasTLA, requested, execute, ns) => ({
  id, hasTLA, requested, execute, ns,
  status: "linked", evaluationError: EMPTY, dfsAncestorIndex: undefined, cycleRoot: EMPTY,
  asyncEvaluationOrder: UNSET, topLevelCapability: EMPTY, asyncParentModules: [], pendingAsyncDependencies: undefined,
});
function Evaluate(module) {
  if (module.status === "evaluating-async" || module.status === "evaluated") {
    if (module.cycleRoot !== EMPTY) module = module.cycleRoot;
  }
  if (module.topLevelCapability !== EMPTY) return module.topLevelCapability.promise;
  const stack = [];
  const capability = newCap();
  module.topLevelCapability = capability;
  try {
    InnerModuleEvaluation(module, stack, 0);
    if (module.status === "evaluated") capability.resolve(undefined);
  } catch (err) {
    for (const m of stack) { m.status = "evaluated"; m.evaluationError = [err]; }
    capability.reject(err);
  }
  return capability.promise;
}
function InnerModuleEvaluation(module, stack, index) {
  if (module.status === "evaluating-async" || module.status === "evaluated") {
    if (module.evaluationError === EMPTY) return index;
    throw module.evaluationError[0];
  }
  if (module.status === "evaluating") return index;
  module.status = "evaluating";
  const moduleIndex = index;
  module.dfsAncestorIndex = index;
  module.pendingAsyncDependencies = 0;
  index++;
  stack.push(module);
  for (const get of module.requested) {
    let required = get();
    index = InnerModuleEvaluation(required, stack, index);
    if (required.status === "evaluating") {
      module.dfsAncestorIndex = Math.min(module.dfsAncestorIndex, required.dfsAncestorIndex);
    } else {
      required = required.cycleRoot;
      if (required.evaluationError !== EMPTY) throw required.evaluationError[0];
    }
    if (typeof required.asyncEvaluationOrder === "number") {
      module.pendingAsyncDependencies++;
      required.asyncParentModules.push(module);
    }
  }
  if (module.hasTLA || module.pendingAsyncDependencies > 0) {
    module.asyncEvaluationOrder = moduleAsyncEvaluationCount++;
    if (module.pendingAsyncDependencies === 0) ExecuteAsyncModule(module);
  } else {
    module.execute();
  }
  if (module.dfsAncestorIndex === moduleIndex) {
    for (;;) {
      const required = stack.pop();
      required.status = required.asyncEvaluationOrder === UNSET ? "evaluated" : "evaluating-async";
      required.cycleRoot = module;
      if (required === module) break;
    }
  }
  return index;
}
function ExecuteAsyncModule(module) {
  // capability + PerformPromiseThen + AsyncBlockStart == calling an async function and then()ing it
  module.execute().then(() => AsyncModuleExecutionFulfilled(module), e => AsyncModuleExecutionRejected(module, e));
}
function GatherAvailableAncestors(module, execList) {
  for (const m of module.asyncParentModules) {
    if (!execList.includes(m) && m.cycleRoot.evaluationError === EMPTY) {
      if (--m.pendingAsyncDependencies === 0) {
        execList.push(m);
        if (!m.hasTLA) GatherAvailableAncestors(m, execList);
      }
    }
  }
}
function AsyncModuleExecutionFulfilled(module) {
  if (module.status === "evaluated") return;
  module.asyncEvaluationOrder = DONE;
  module.status = "evaluated";
  if (module.topLevelCapability !== EMPTY) module.topLevelCapability.resolve(undefined);
  const execList = [];
  GatherAvailableAncestors(module, execList);
  execList.sort((a, b) => a.asyncEvaluationOrder - b.asyncEvaluationOrder);
  for (const m of execList) {
    if (m.status === "evaluated") continue;
    if (m.hasTLA) ExecuteAsyncModule(m);
    else {
      try { m.execute(); } catch (e) { AsyncModuleExecutionRejected(m, e); continue; }
      m.asyncEvaluationOrder = DONE;
      m.status = "evaluated";
      if (m.topLevelCapability !== EMPTY) m.topLevelCapability.resolve(undefined);
    }
  }
}
function AsyncModuleExecutionRejected(module, error) {
  if (module.status === "evaluated") return;
  module.evaluationError = [error];
  module.status = "evaluated";
  module.asyncEvaluationOrder = DONE;
  if (module.topLevelCapability !== EMPTY) module.topLevelCapability.reject(error);
  for (const m of module.asyncParentModules) AsyncModuleExecutionRejected(m, error);
}
// EvaluateImportCall + ContinueDynamicImport with a host that finishes loading synchronously.
function DynamicImport(module) {
  const cap = newCap();
  Promise.resolve().then(() => {
    Evaluate(module).then(() => cap.resolve(module.ns), cap.reject);
  });
  return cap.promise;
}
`;

export function emitSpecEmu(g) {
  const out = [SPEC_RUNTIME];
  out.push(`var ${g.mods.flatMap(names).join(", ")};`);
  for (const m of g.mods) {
    const lines = bodyLines(g, m, to => `DynamicImport(M_${g.mods[to].id})`);
    out.push(
      `const M_${m.id} = Module("${m.id}", ${hasTLA(m)}, [${m.imports.map(i => `() => M_${g.mods[i].id}`).join(", ")}], ${hasTLA(m) ? "async " : ""}function () {\n  ${lines.join("\n  ")}\n}, ${namespace(m)});`,
    );
  }
  out.push(`await Evaluate(M_m0);`);
  return out.join("\n") + "\n";
}
