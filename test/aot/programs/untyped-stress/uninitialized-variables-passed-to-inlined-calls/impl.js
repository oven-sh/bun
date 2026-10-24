function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
function first() { return 2; }
function second() { return 3; }
function readsTooEarly() { keepsOfLet(mayBeEmpty); }
let thrown = "nothing";
try {
    readsTooEarly();
} catch (error) {
    thrown = error.constructor.name;
}
check(thrown, "ReferenceError", "a variable that is read before it is initialized");

let mayBeEmpty;
var isNeverEmpty;
let keptOfLet = 0;
let keptOfVar = 0;
let keptUntested = 0;
function keepsOfLet(e) { keptOfLet = e ?? 0; }
function keepsOfVar(e) { keptOfVar = e ?? 0; }
function keepsUntested(e) { keptUntested = e; }
function passesLet() { keepsOfLet(mayBeEmpty); }
function passesVar() { keepsOfVar(isNeverEmpty); }
function passesLetUntested() { keepsUntested(mayBeEmpty); }
function callsKept() { return (keptOfLet === 0 ? 1 : keptOfLet()) * 100 + (keptOfVar === 0 ? 1 : keptOfVar()) * 10 + (keptUntested === undefined ? 1 : keptUntested()); }
let letAlwaysUndefined;
var varAlwaysUndefined;
function passesLetAlwaysUndefined() { keepsOfLet(letAlwaysUndefined); }
function passesVarAlwaysUndefined() { keepsOfVar(varAlwaysUndefined); }
let results = [];
for (let i = 0; i < 3; i++) {
    mayBeEmpty = i === 0 ? undefined : i === 1 ? first : second;
    isNeverEmpty = i === 0 ? undefined : i === 1 ? first : second;
    passesLet();
    passesVar();
    passesLetUntested();
    results.push(callsKept());
}
check(results.join(), "111,222,333", "what the inlined callees stored");
passesLetAlwaysUndefined();
passesVarAlwaysUndefined();
check(keptOfLet, 0, "what is stored for a variable that is always undefined");
check(keptOfVar, 0, "what is stored for a variable that is always undefined and never empty");
})();

(function () {
function first() { return 2; }
function second() { return 3; }
let mayBeEmpty;
var isNeverEmpty;
let impossible = 0;
let nulls = 0;
let keptInTwoSteps = 0, keptAsLowered = 0, keptThroughTemporary = 0, keptAsLoweredChain = 0, keptOfVarInTwoSteps = 0, keptOfVarAsLowered = 0, keptBehindOneStep = 0;
function inTwoSteps(e) { if (e !== undefined && e !== null) return e; return 0; }
function asLowered(e) { return e !== null && e !== void 0 ? e : 0; }
function throughTemporary(e) { var _a; return (_a = e) !== null && _a !== void 0 ? _a : 0; }
function asLoweredChain(e) { return e === null || e === void 0 ? 0 : e; }
function ofVarInTwoSteps(e) { if (e !== undefined && e !== null) return e; return 0; }
function ofVarAsLowered(e) { return e !== null && e !== void 0 ? e : 0; }
function behindOneStep(e) { return e !== undefined ? e : 0; }
function passesInTwoSteps() { const kept = inTwoSteps(mayBeEmpty); keptInTwoSteps = kept; if (kept === null) ++impossible; }
function passesAsLowered() { const kept = asLowered(mayBeEmpty); keptAsLowered = kept; if (kept === undefined) ++impossible; }
function passesThroughTemporary() { const kept = throughTemporary(mayBeEmpty); keptThroughTemporary = kept; if (kept === undefined) ++impossible; }
function passesAsLoweredChain() { const kept = asLoweredChain(mayBeEmpty); keptAsLoweredChain = kept; if (kept === undefined) ++impossible; }
function passesVarInTwoSteps() { const kept = ofVarInTwoSteps(isNeverEmpty); keptOfVarInTwoSteps = kept; if (kept === null) ++impossible; }
function passesVarAsLowered() { const kept = ofVarAsLowered(isNeverEmpty); keptOfVarAsLowered = kept; if (kept === undefined) ++impossible; }
function passesBehindOneStep() { const kept = behindOneStep(mayBeEmpty); keptBehindOneStep = kept; if (kept === null) ++nulls; }
const resultOf = kept => kept === 0 ? 1 : kept === null ? 0 : kept();
let results = [];
for (let i = 0; i < 4; i++) {
    mayBeEmpty = i === 0 ? undefined : i === 1 ? null : i === 2 ? first : second;
    isNeverEmpty = i === 0 ? undefined : i === 1 ? null : i === 2 ? first : second;
    passesInTwoSteps();
    passesAsLowered();
    passesThroughTemporary();
    passesAsLoweredChain();
    passesVarInTwoSteps();
    passesVarAsLowered();
    passesBehindOneStep();
    results.push([keptInTwoSteps, keptAsLowered, keptThroughTemporary, keptAsLoweredChain, keptOfVarInTwoSteps, keptOfVarAsLowered, keptBehindOneStep].map(resultOf).join(""));
}
check(results.join(), "1111111,1111110,2222222,3333333", "what inlined callees return behind tests in two steps");
check(impossible, 0, "results that are nothing behind both tests");
check(nulls, 1, "null behind the test for undefined alone");
})();
console.log("passed");
