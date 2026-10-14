const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function callsOneFunction(f) { const result = f(1); return result + 1; }
function callsNewClosures(f) { const result = f(1); return result + 1; }
function callsSecondFunctionLater(f) { const result = f(1); return result + 1; }
function callsHostFunctionLater(f) { const result = f(1); return result ? 1 : 0; }
function callsThroughTwoSites(f, g) {
    let result = f(1);
    if (g)
        result += g(1);
    return result;
}
function returnsArgument(x) { return x; }
function addsOne(x) { return x + 1; }
function makeClosure(k) { return x => x + k; }

const dumps = typeof aotOperationCount === "function" && aotOperationCount("operationAOTNoteCallee") !== null && isAOTCompiled(callsOneFunction) && (aotRemarks("callsOneFunction") || []).includes("cached-call");
function readDump() {
    const result = { sites: 0, several: 0 };
    if (!dumps)
        return result;
    fullGC();
    const lines = readFile("aot-callees-seen-by-call-sites.counts.callees").split("\n");
    if (lines[lines.length - 1] === "")
        lines.length--;
    const last = lines[lines.length - 1].split("\t");
    lines.length--;
    check(last[0], "N", "the last line of the dump");
    check(Number(last[1]), lines.length, "the number of sites the dump says it has");
    for (let i = 0; i < lines.length; ++i) {
        const fields = lines[i].split("\t");
        check(fields.length, 4, "the number of fields of a line");
        check(fields[3] === "0" || fields[3] === "1", true, "the last field is a bit");
        if (fields[3] === "1")
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

for (let i = 0; i < 200; ++i) {
    check(callsOneFunction(returnsArgument), 2, "a call of one function");
    check(callsNewClosures(makeClosure(i)), i + 2, "a call of a new closure");
    check(callsSecondFunctionLater(returnsArgument), 2, "a call of one function so far");
    check(callsHostFunctionLater(returnsArgument), 1, "a call of one function so far");
    check(callsThroughTwoSites(returnsArgument, null), 1, "a call through the first of two sites");
}
before = after;
after = readDump();
if (dumps) {
    check(after.sites, before.sites + 5, "five sites have run");
    check(after.several, before.several, "each of them has seen one function, whatever the number of function objects");
    check(aotOperationCount("operationAOTNoteCallee") > 0, true, "misses reach the operation");
}

check(callsThroughTwoSites(returnsArgument, addsOne), 3, "the first call through the second site");
for (let i = 0; i < 100; ++i)
    check(callsThroughTwoSites(returnsArgument, returnsArgument), 2, "later calls through the second site");
before = after;
after = readDump();
if (dumps) {
    check(after.sites, before.sites + 1, "the second site has run");
    check(after.several, before.several + 1, "its first callee was another function than all the later ones");
}

check(callsSecondFunctionLater(addsOne), 3, "a second function");
check(callsHostFunctionLater(Number.isNaN), 0, "a host function");
before = after;
after = readDump();
check(after.sites, before.sites, "no new site");
check(after.several, before.several + (dumps ? 2 : 0), "one site saw a second function, one a host function");

const missesBefore = dumps ? aotOperationCount("operationAOTNoteCallee") : 0;
for (let i = 0; i < 1000; ++i)
    check(callsOneFunction(returnsArgument), 2, "a call that hits");
check(dumps ? aotOperationCount("operationAOTNoteCallee") : 0, missesBefore, "a hit does not reach the operation");
for (let i = 0; i < 10000; ++i)
    check(callsNewClosures(makeClosure(i)), i + 2, "a call of a new closure");
check((dumps ? aotOperationCount("operationAOTNoteCallee") : 0) - missesBefore >= (dumps ? 10000 : 0), true, "every call of a new closure is a miss");
before = after;
after = readDump();
check(after.sites, before.sites, "no new site");
check(after.several, before.several, "ten thousand closures of one function are one function");
console.log("passed");
