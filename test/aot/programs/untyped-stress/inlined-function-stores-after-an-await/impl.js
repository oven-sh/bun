const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function has(name, remark) {
    let remarks = aotRemarks(name);
    return remarks && remarks.length ? remarks.some(other => other === remark || other.startsWith(remark + ":")) : undefined;
}
function says(name, remark) { check(has(name, remark) !== false, true, name + " has " + remark); }
function doesNotSay(name, remark) { check(has(name, remark) !== true, true, name + " has no " + remark); }

(function () {
let kept = { a: 0 };
function keep(v) { kept = v; }
function readsKept() { return kept.a; }
async function storesThroughInlinedCallee(i, c) { let x = i & 1 ? { a: i } : undefined; if (c) await 1; else await 2; if (!x) return -1; keep(x); let r = readsKept(); await 3; return r; }
let done = [];
for (let i = 0; i < 6; i++)
    storesThroughInlinedCallee(i, i & 2).then(v => done.push(v));
drainMicrotasks();
check(done.join(), "-1,-1,-1,1,3,5", "what was stored by the inlined callee and read back");
check(kept.a, 5, "the last value stored");
says("storesThroughInlinedCallee", "inlined-call:keep");
says("storesThroughInlinedCallee", "reads-unchanged-register-from-frame");
says("storesThroughInlinedCallee", "narrowed-tested-value");
})();
console.log("passed");
