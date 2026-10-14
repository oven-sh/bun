const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function callsAnotherFunctionFirst(f) { const result = f(1); return result + 1; }
function callsOneFunction(f) { const result = f(1); return result + 1; }
function tailCallsAnotherFunctionFirst(f) { "use strict"; return f(1); }
function tailCallsOneFunction(f) { "use strict"; return f(1); }
function returnsArgument(x) { return x; }
function addsOne(x) { return x + 1; }

const dumps = typeof aotOperationCount === "function" && aotOperationCount("operationAOTNoteCallee") !== null && isAOTCompiled(callsOneFunction) && (aotRemarks("callsOneFunction") || []).includes("cached-call");
function readDump() {
    const result = { sites: 0, several: 0 };
    if (!dumps)
        return result;
    fullGC();
    const lines = readFile("aot-callees-seen-from-the-first-call.counts.callees").split("\n");
    if (lines[lines.length - 1] === "")
        lines.length--;
    const last = lines[lines.length - 1].split("\t");
    lines.length--;
    check(last[0], "N", "the last line of the dump");
    check(Number(last[1]), lines.length, "the number of sites the dump says it has");
    for (let i = 0; i < lines.length; ++i) {
        if (lines[i].split("\t")[3] === "1")
            result.several++;
    }
    result.sites = lines.length;
    return result;
}

let before = readDump();
for (let i = 0; i < 30; ++i) {
    check(i, i, "a helper");
    before = readDump();
}
let after = readDump();
check(after.sites, before.sites, "the sites of the helpers, once they are all in the dump");
check(after.several, before.several, "the sites of the helpers that saw several callees");

check(callsOneFunction(returnsArgument), 2, "the first call");
check(tailCallsOneFunction(returnsArgument), 1, "the first tail call");
before = after;
after = readDump();
check(after.sites, before.sites + (dumps ? 2 : 0), "a site is in the dump after its first call");
check(after.several, before.several, "each has seen one function");

check(callsAnotherFunctionFirst(addsOne), 3, "the first call");
check(tailCallsAnotherFunctionFirst(addsOne), 2, "the first tail call");
for (let i = 0; i < 200; ++i) {
    check(callsAnotherFunctionFirst(returnsArgument), 2, "a later call");
    check(tailCallsAnotherFunctionFirst(returnsArgument), 1, "a later tail call");
    check(callsOneFunction(returnsArgument), 2, "a later call");
    check(tailCallsOneFunction(returnsArgument), 1, "a later tail call");
}
before = after;
after = readDump();
check(after.sites, before.sites + (dumps ? 2 : 0), "two more sites have run");
check(after.several, before.several + (dumps ? 2 : 0), "the first callee of each was another function than all the later ones");
if (dumps)
    check(aotOperationCount("CallCachedMiss:cache-in-shared-data"), 0, "no call went unobserved");
console.log("passed");
