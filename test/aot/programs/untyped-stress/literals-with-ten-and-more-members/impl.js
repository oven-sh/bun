const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useAOTInlining=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTDataStubs=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--forceGCSlowPaths=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--verifyGC=1", "--scribbleFreeCells=1", "--useZombieMode=1", "--slowPathAllocsBetweenGCs=10")

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function remarksOf(f) {
    return typeof aotRemarks === "function" && isAOTCompiled(f) ? aotRemarks(f.name) : null;
}
function matches(remark, pattern) { return remark === pattern || remark.startsWith(pattern + ":"); }
function applies(f, ...patterns) {
    let remarks = remarksOf(f);
    for (let pattern of remarks ? patterns : []) {
        if (!remarks.some(remark => matches(remark, pattern)))
            throw new Error(pattern + " does not apply to " + f.name + ": " + remarks.join(" "));
    }
}
function doesNotApply(f, ...patterns) {
    let remarks = remarksOf(f);
    for (let pattern of remarks ? patterns : []) {
        if (remarks.some(remark => matches(remark, pattern)))
            throw new Error(pattern + " applies to " + f.name + ": " + remarks.join(" "));
    }
}

function readsProperty(o) { return o.property; }
readsProperty({ property: 1 });
const usesDataStubs = (remarksOf(readsProperty) || []).includes("calls:GetById");

let kept = null;
function object1(a) { kept = { p: a }; return kept; }
function object2(a, b) { kept = { p: a, q: b }; return kept; }
function object3(a, b, c) { kept = { p: a, q: b, r: c }; return kept; }
function object4(a, b, c, d) { kept = { p: a, q: b, r: c, s: d }; return kept; }
function object5(a, b, c, d, e) { kept = { p: a, q: b, r: c, s: d, t: e }; return kept; }
function object6(a, b, c, d, e, f) { kept = { p: a, q: b, r: c, s: d, t: e, u: f }; return kept; }
function object7(a, b, c, d, e, f, g) { kept = { p: a, q: b, r: c, s: d, t: e, u: f, v: g }; return kept; }
function object10(a, b) { kept = { p: a, q: b, r: a, s: b, t: a, u: b, v: a, w: b, x: a, y: b }; return kept; }
function constants() { kept = { p: 1, q: null, r: undefined, s: true, t: "text" }; return kept; }
function nested(i) { kept = { first: { n: i }, second: [i, "s" + i], third: "t" + i, fourth: { m: { k: i } } }; return kept; }
function array1(a) { kept = [a]; return kept; }
function array2(a, b) { kept = [a, b]; return kept; }
function array3(a, b, c) { kept = [a, b, c]; return kept; }
function array4(a, b, c, d) { kept = [a, b, c, d]; return kept; }
function array5(a, b, c, d, e) { kept = [a, b, c, d, e]; return kept; }
function emptyArray() { kept = []; return kept; }
function int32Array(a, b) { kept = [a | 0, b | 0, 7]; return kept; }
function inTry(a, b) { try { kept = { p: a, q: [a, b] }; return kept; } catch (e) { return null; } }

const objects = [object1, object2, object3, object4, object5, object6, object7];
const arrays = [array1, array2, array3, array4, array5];
const names = ["p", "q", "r", "s", "t", "u", "v"];

function checkObject(f, count, round) {
    let values = [];
    for (let i = 0; i < count; ++i)
        values.push(i % 3 ? "v" + round + i : i % 2 ? round + i + 0.5 : { n: round + i });
    let o = f(...values);
    check(Object.keys(o).join(), names.slice(0, count).join(), f.name + ": names in order");
    for (let i = 0; i < count; ++i)
        check(o[names[i]], values[i], f.name + "." + names[i]);
    check(Object.getPrototypeOf(o), Object.prototype, f.name + ": prototype");
    o.later = round;
    o.evenLater = values[0];
    check(o.later, round, f.name + ": a property added after birth");
    check(o.evenLater, values[0], f.name + ": a second property added after birth");
    check(Object.keys(o).length, count + 2, f.name + ": names after two additions");
    for (let i = 0; i < count; ++i)
        check(o[names[i]], values[i], f.name + "." + names[i] + " after additions");
}

function checkArray(f, count, round) {
    let values = [];
    for (let i = 0; i < count; ++i)
        values.push(i % 2 ? "e" + round + i : { n: round + i });
    let a = f(...values);
    check(Array.isArray(a), true, f.name + ": is an array");
    check(a.length, count, f.name + ": length");
    for (let i = 0; i < count; ++i)
        check(a[i], values[i], f.name + "[" + i + "]");
    a.length = count + 2;
    for (let i = count; i < count + 2; ++i) {
        check(a[i], undefined, f.name + ": a hole past the elements");
        check(i in a, false, f.name + ": nothing past the elements");
    }
    a.length = count;
    a.push(round);
    check(a[count], round, f.name + ": a pushed element");
    check(a.length, count + 1, f.name + ": length after a push");
}

const rounds = 1200;
for (let round = 0; round < rounds; ++round) {
    for (let i = 0; i < objects.length; ++i)
        checkObject(objects[i], i + 1, round);
    for (let i = 0; i < arrays.length; ++i)
        checkArray(arrays[i], i + 1, round);

    let ten = object10(round, "b" + round);
    check(Object.keys(ten).join(""), "pqrstuvwxy", "ten names");
    check(ten.x, round, "the ninth of ten");
    check(ten.y, "b" + round, "the tenth of ten");

    let c = constants();
    check(JSON.stringify(c), '{"p":1,"q":null,"s":true,"t":"text"}', "constants");
    check("r" in c, true, "a field that is undefined is there");

    let n = nested(round);
    check(n.first.n, round, "an object made for a field");
    check(n.second[0], round, "an array made for a field");
    check(n.second[1], "s" + round, "a string made for an element");
    check(n.third, "t" + round, "a string made for a field");
    check(n.fourth.m.k, round, "an object in an object made for a field");

    let numbers = int32Array(round, round * 3);
    check(numbers.join(), round + "," + round * 3 + ",7", "integers");
    numbers[1] = 0.5;
    check(numbers[1], 0.5, "a double stored among integers");
    numbers[0] = "text";
    check(numbers.join(), "text,0.5,7", "a string stored among numbers");

    check(emptyArray().length, 0, "no elements");
    let t = inTry(round, "x");
    check(t.q[0], round, "in a try block");
    check(t.q[1], "x", "in a try block");
}

if (usesDataStubs) {
    for (let i = 0; i < 4; ++i)
        applies(objects[i], "literal-born-from-registers:" + (i + 1), "calls:NewObjectLiteral" + (i + 1));
    for (let f of [object1, object2, object3, object4])
        doesNotApply(f, "calls:operationAOTNewObjectLiteral");
    applies(constants, "allocation-escapes");
    applies(nested, "literal-born-from-registers:4", "literal-born-from-registers:1", "array-born-from-registers:2");
    applies(inTry, "literal-born-from-registers:2", "array-born-from-registers:2");
    for (let i = 0; i < 4; ++i) {
        applies(arrays[i], "array-born-from-registers:" + (i + 1), "calls:NewArrayLiteral" + (i + 1));
        doesNotApply(arrays[i], "calls:operationAOTNewArray", "calls:NewInt32ArrayLiteral" + (i + 1));
    }
    applies(int32Array, "array-born-from-registers:3", "calls:NewInt32ArrayLiteral3");
    doesNotApply(int32Array, "calls:NewArrayLiteral3");
}
for (let f of [object7, object10]) {
    doesNotApply(f, "literal-born-from-registers");
    applies(f, "calls:operationAOTNewObjectLiteral");
}
for (let f of [array5, emptyArray])
    doesNotApply(f, "array-born-from-registers");
if (!usesDataStubs) {
    for (let f of [...objects, constants, nested, inTry])
        doesNotApply(f, "literal-born-from-registers");
    for (let f of [...arrays, int32Array, nested, inTry])
        doesNotApply(f, "array-born-from-registers");
}

if (usesDataStubs && typeof aotOperationCount === "function" && aotOperationCount("operationAOTNewObjectLiteral") !== null) {
    let before = aotOperationCount("operationAOTNewObjectLiteral") + aotOperationCount("operationAOTNewArray");
    for (let i = 0; i < 20000; ++i) {
        object5(i, i, i, i, i);
        array2(i, i);
    }
    let arrivals = aotOperationCount("operationAOTNewObjectLiteral") + aotOperationCount("operationAOTNewArray") - before;
    if (arrivals > 2000)
        throw new Error("40000 births reached the runtime " + arrivals + " times");
}
console.log("passed");
