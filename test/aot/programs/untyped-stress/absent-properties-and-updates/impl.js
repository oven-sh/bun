const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function remarksOf(f) {
    let remarks = aotRemarks(f.name);
    if (!remarks && isAOTCompiled(f))
        throw new Error("no remarks for " + f.name);
    return remarks;
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
function withDefault({ a, b = 2 }) { return a * b; }
function missing(i) { return withDefault({ a: i }); }
function present(i) { return withDefault({ a: i, b: 3 }); }
function inherited({ a, toString }) { return typeof toString + a; }
function readsInherited(i) { return inherited({ a: i }); }
function constructorOf({ constructor }) { return constructor === Object; }
function protoOf(o) { return o.__proto__ === Object.prototype; }
function increment(o) { o.n++; return o.n; }
function decrement(o) { --o.n; return o.n; }
function postfix(x) { return x++ + x; }
function coalesce(o) { o.n ??= 5; o.m ||= 6; o.k &&= 7; return o.n + "," + o.m + "," + o.k; }
for (let round = 0; round < 3; ++round) {
    check(missing(4), 8, "a property that the literal lacks");
    check(present(4), 12, "a property that it has");
    check(readsInherited(1), "function1", "a property of Object.prototype");
    check(constructorOf({ a: 1 }), true, "constructor");
    check(protoOf({ a: 1 }), true, "__proto__");
    check(increment({ n: 1 }), 2, "an integer");
    check(increment({ n: 1.5 }), 2.5, "a double");
    check(increment({ n: 2147483647 }), 2147483648, "the largest int32");
    check(decrement({ n: -2147483648 }), -2147483649, "the smallest int32");
    check(decrement({ n: 0.5 }), -0.5, "a double, decremented");
    check(increment({ n: "4" }), 5, "a string");
    check(increment({ n: 10n }), 11n, "a BigInt");
    check(increment({ n: undefined }), NaN, "undefined");
    check(increment({ n: -0 }), 1, "negative zero");
    check(postfix(1.25), 3.5, "postfix on a double");
    check(coalesce({ n: null, m: 0, k: 1 }), "5,6,7", "short-circuit assignments, taken");
    check(coalesce({ n: 1, m: 2, k: 0 }), "1,2,0", "short-circuit assignments, not taken");
}

function escape(o) { return o; }
function readsBoth(i) { let { a, b } = { a: i, b: i + 1 }; return a + b; }
function readsAbsent(i) { let { a, b = 2 } = { a: i }; return a * b; }
function readsToString(i) { let { a, toString } = { a: i }; return typeof toString + a; }
function readsProto(i) { let o = { a: i }; return o.__proto__ === Object.prototype; }
function readsComputed(i, k) { let o = { a: i }; return o[k]; }
function escapes(i) { let o = { a: i }; escape(o); return o.a; }
function isReturned(i) { return { a: i }; }
function isWritten(i) { let o = { a: i }; o.b = 1; return o.a + o.b; }
function hasGetter(i) { let o = { get a() { return i; } }; return o.a; }
function hasPrototype(i, p) { let o = { __proto__: p, a: i }; return o.b; }
for (let round = 0; round < 3; ++round) {
    check(readsBoth(1), 3, "both properties");
    check(readsAbsent(4), 8, "a property that is absent");
    check(readsToString(1), "function1", "toString");
    check(readsProto(1), true, "__proto__");
    check(readsComputed(1, "a"), 1, "a computed name");
    check(escapes(1), 1, "an object that escapes");
    check(isReturned(1).a, 1, "an object that is returned");
    check(isWritten(1), 2, "an object that is written to");
    check(hasGetter(1), 1, "a getter");
    check(hasPrototype(1, { b: 5 }), 5, "another prototype");
}
applies(readsBoth, "scalar-replaced-object");
applies(readsAbsent, "scalar-replaced-object", "absent-property-is-undefined:b");
doesNotApply(readsBoth, "absent-property-is-undefined", "calls:operationAOTNewObjectLiteral", "literal-born-from-registers");
doesNotApply(readsAbsent, "calls:operationAOTNewObjectLiteral", "literal-born-from-registers", "calls:GetById");
for (let f of [readsToString, readsProto, readsComputed, escapes, isReturned, isWritten, hasGetter, hasPrototype])
    doesNotApply(f, "scalar-replaced-object", "absent-property-is-undefined");
console.log("passed");
