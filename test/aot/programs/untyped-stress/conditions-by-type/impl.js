function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function Thing(n) { this.n = n; }
const masquerader = makeMasquerader();
const foreignMasquerader = createGlobalObject().makeMasquerader();
function ReturnsMasquerader() { return masquerader; }
function ReturnsForeignMasquerader() { return foreignMasquerader; }
function ReturnsFunction() { return function () { }; }
function ReturnsArray() { return []; }

function objectOrUndefined(make) { let o = make === true ? new Thing(1) : undefined; return o ? "yes" : "no"; }
function objectOrNull(make) { let o = make === true ? new Thing(1) : null; if (!o) return "no"; return "yes"; }
function constructed(C) { let o = new C(); return o ? "yes" : "no"; }
function objectOrString(which) { let o = which === 0 ? new Thing(1) : which === 1 ? "" : which === 2 ? "text" : undefined; return o ? "yes" : "no"; }
function objectOrBoolean(which) { let o = which === 0 ? new Thing(1) : which === 1 ? false : which === 2 ? true : null; return o ? "yes" : "no"; }
function anything(x) { return x ? "yes" : "no"; }
noInline(anything);

check(objectOrUndefined(true), "yes", "an object");
check(objectOrUndefined(false), "no", "undefined");
check(objectOrNull(true), "yes", "an object");
check(objectOrNull(false), "no", "null");
check(constructed(Thing), "yes", "a constructed object");
check(constructed(ReturnsFunction), "yes", "a function");
check(constructed(ReturnsArray), "yes", "an empty array");
check(constructed(ReturnsMasquerader), "no", "an object that masquerades as undefined");
check(constructed(ReturnsForeignMasquerader), "yes", "an object that masquerades as undefined in another realm");
check([0, 1, 2, 3].map(objectOrString).join(), "yes,no,yes,no", "an object or a string");
check([0, 1, 2, 3].map(objectOrBoolean).join(), "yes,no,yes,no", "an object or a boolean");
check([0, 1, "", "a", null, undefined, {}, masquerader, foreignMasquerader, NaN, -0, 0n, 1n, Symbol()].map(anything).join(), "no,yes,no,yes,no,no,yes,no,yes,no,no,no,yes,yes", "anything");

function int32OrUndefined(n, given) { let v = given === true ? n | 0 : undefined; return v ? "yes" : "no"; }
function int32OrNull(n, given) { let v = given === true ? n | 0 : null; return !v ? "no" : "yes"; }
function numberOrUndefined(n, given) { let v = given === true ? +n : undefined; return v ? "yes" : "no"; }
function numberOrNull(n, given) { let v = given === true ? +n : null; return v ? "yes" : "no"; }
check([0, 1, -1, 0x7fffffff, -0x80000000].map(n => int32OrUndefined(n, true)).join(), "no,yes,yes,yes,yes", "an Int32");
check(int32OrUndefined(1, false), "no", "undefined in place of an Int32");
check([0, 1, -1].map(n => int32OrNull(n, true)).join(), "no,yes,yes", "an Int32");
check(int32OrNull(1, false), "no", "null in place of an Int32");
check([0, -0, NaN, 0.5, -0.5, 1, Infinity, -Infinity, 5e-324, "0", "7"].map(n => numberOrUndefined(n, true)).join(), "no,no,no,yes,yes,yes,yes,yes,yes,no,yes", "a number");
check(numberOrUndefined(1, false), "no", "undefined in place of a number");
check([0, 0.5, NaN].map(n => numberOrNull(n, true)).join(), "no,yes,no", "a number");
check(numberOrNull(1, false), "no", "null in place of a number");

function comparesOptional(a, hasA, b, hasB) {
    let x = hasA ? +a : undefined, y = hasB ? +b : undefined;
    return (x < y ? "<" : "") + (x <= y ? "[" : "") + (x > y ? ">" : "") + (x >= y ? "]" : "");
}
function comparesOptionalWithNull(a, hasA, b) { let x = hasA ? +a : null; return x < +b ? "<" : ""; }
check(comparesOptional(1, true, 2, true), "<[", "1 and 2");
check(comparesOptional(2.5, true, 2.5, true), "[]", "2.5 and 2.5");
check(comparesOptional(3, true, -0.5, true), ">]", "3 and -0.5");
check(comparesOptional(0, true, -0, true), "[]", "0 and -0");
check(comparesOptional(NaN, true, 1, true), "", "NaN and 1");
check(comparesOptional(1, false, 1, true), "", "undefined and 1");
check(comparesOptional(1, true, 1, false), "", "1 and undefined");
check(comparesOptional(1, false, 1, false), "", "undefined and undefined");
check(comparesOptionalWithNull(1, false, 1), "<", "null and 1");
check(comparesOptionalWithNull(1, true, 1), "", "1 and 1");

function withInt32(x) { return (x < 10 ? "<" : "") + (x <= 10 ? "[" : "") + (x > 10 ? ">" : "") + (x >= 10 ? "]" : ""); }
function int32First(x) { return (10 < x ? "<" : "") + (10 <= x ? "[" : "") + (10 > x ? ">" : "") + (10 >= x ? "]" : ""); }
function unknownOperands(x, y) { return x < y ? "<" : ""; }
noInline(withInt32);
noInline(int32First);
noInline(unknownOperands);
let order = [];
const values = [9, 10, 11, -1, 9.5, 10.5, NaN, "9", "11", "text", undefined, null, true, 9n, 11n, { valueOf() { order.push("valueOf"); return 9; } }, [10]];
check(values.map(withInt32).join(), "<[,[],>],<[,<[,>],,<[,>],,,<[,<[,<[,>],<[,[]", "compared with 10");
check(values.map(int32First).join(), ">],[],<[,>],>],<[,,>],<[,,,>],>],>],<[,>],[]", "10 compared with");
check(order.length, 8, "conversions of the object");
check(unknownOperands(1, 2) + unknownOperands("b", "a") + unknownOperands("a", "b") + unknownOperands(2.5, {}), "<<", "unknown operands");
let thrown = "nothing";
try { withInt32(Symbol()); } catch (error) { thrown = error.constructor.name; }
check(thrown, "TypeError", "a symbol compared with 10");

function holder() {
    let held;
    function setsAnything(v) { held = v; }
    function setsObject(n) { held = { n }; }
    function setsNumber(n) { held = n | 0; }
    function gets() { return held; }
    return { setsAnything, setsObject, setsNumber, gets };
}
let old = holder();
noInline(old.setsAnything);
fullGC();
for (let i = 0; i < 200; ++i) {
    old.setsAnything(i);
    check(old.gets(), i, "a number in an old scope");
    old.setsAnything({ i, text: "kept " + i });
    edenGC();
    check(old.gets().text, "kept " + i, "a new object in an old scope");
    old.setsAnything("text " + i);
    edenGC();
    check(old.gets(), "text " + i, "a new string in an old scope");
    old.setsObject(i);
    edenGC();
    check(old.gets().n, i, "a new literal in an old scope");
    old.setsNumber(i + 0.5);
    check(old.gets(), i, "an Int32 in an old scope");
}
console.log("passed");
