function byMember() { return "by member"; }
function byComputedName() { return "by computed name"; }
function byAssign() { return "by Object.assign"; }
function byDefine() { return "by defineProperty"; }
function byGetter() { return "by a getter"; }

(globalThis as any).byMember = byMember;
(globalThis as any)["byComputed" + "Name"] = byComputedName;
Object.assign(globalThis, { byAssign });
Object.defineProperty(globalThis, "byDefine", { value: byDefine });
Object.defineProperty(globalThis, "byGetter", { get: () => byGetter });
