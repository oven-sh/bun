function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...parameters) {
    try {
        f(...parameters);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
let kept = { };
function keep(name, value) { kept[name] = value; return value; }
noInline(keep);
let anything = keep("anything", 7);

(function () {
    function probe(x) { return x; }
    function probeCaller(x) { return probe(x); }
    probeCaller(1);

    function addsInt32(a, b) { return a + b; }
    function scalesDouble(a, b) { return a * 0.5 + b; }
    function lengthOfString(s) { return s.length; }
    function readsObject(o, d) { return o.x + d; }
    function usesThis(d) { "use strict"; return this.x + d; }
    function callsAddsInt32(x) { return addsInt32(x | 0, 2) + 1; }
    function callsScalesDouble(x) { return scalesDouble(x + 0.5, 1.5); }
    function callsLengthOfString(x) { return lengthOfString("abc" + x); }
    function callsReadsObject(x) { return readsObject({ x: x | 0, y: 2 }, 1); }
    for (let f of [addsInt32, scalesDouble, lengthOfString, readsObject, usesThis])
        keep(f.name, f);
    check([callsAddsInt32(1), callsScalesDouble(1), callsLengthOfString(1), callsReadsObject(1)].join(), "4,2.25,4,2", "direct calls");

    function appliesCallback(f, x) { return f(x); }
    function staysClosed(x) { return x + 1; }
    function passesCallback(x) { return appliesCallback(staysClosed, x | 0); }
    keep("appliesCallback", appliesCallback);
    check(passesCallback(1), 2, "a callback passed to an open helper by a known call site");

    function takesAnything(a) { return String(a).length; }
    function callsTakesAnything() { return takesAnything(anything); }
    keep("takesAnything", takesAnything);
    check(callsTakesAnything(), 1, "a direct call that passes anything");

    function firstOfPhi(a) { return a + 1; }
    function secondOfPhi(a) { return a + 2; }
    function callsOneOfTwo(which) { let f = which ? firstOfPhi : secondOfPhi; return f(1) + firstOfPhi(1) + secondOfPhi(1); }
    check(callsOneOfTwo(true) + callsOneOfTwo(false), 7 + 8, "two functions that meet in a phi");

    function countsDown(n) { return n <= 0 ? 0 : 1 + countsDown(n - 1); }
    keep("countsDown", countsDown);
    check(countsDown(3), 3, "recursion by name");

    function* generates(a) { yield a + 1; }
    async function awaits(a) { return a + 1; }
    function usesArguments(a) { return a + arguments.length; }
    function makesClosure(a) { return () => a + 1; }
    function callsTheRest() { return generates(1).next().value + usesArguments(1) + makesClosure(1)() + (awaits(1) instanceof Promise ? 1 : 0); }
    for (let f of [generates, awaits, usesArguments, makesClosure])
        keep(f.name, f);
    check(callsTheRest(), 2 + 2 + 2 + 1, "functions that get no second body");
})();

check([kept.addsInt32(1, 2), kept.addsInt32("a", "b"), kept.addsInt32(1.5, 2), kept.addsInt32(), kept.addsInt32(1, 2, 3), kept.addsInt32({ valueOf() { return 1; } }, 1n === 1n)].join(), "3,ab,3.5,NaN,3,2", "from outside, with other types");
check([kept.addsInt32.call(null, 1, 2), kept.addsInt32.apply(null, ["a", 1]), kept.addsInt32.bind(null, "x")("y"), Reflect.apply(kept.addsInt32, null, [2, 3]), [1, 2].map(kept.addsInt32).join("|"), typeof new kept.addsInt32(1, 2)].join(), "3,a1,xy,5,1|3,object", "call, apply, bind, Reflect.apply, a callback of map, new");
check([kept.scalesDouble(2, 1), kept.scalesDouble("4", "x"), kept.lengthOfString("ab"), kept.lengthOfString([1, 2, 3]), kept.lengthOfString({ length: "l" }), thrownBy(kept.lengthOfString, undefined)].join(), "2,2x,2,3,l,TypeError", "doubles and strings from outside");
check([kept.readsObject({ x: 1 }, 1), kept.readsObject({ y: 0, x: "s" }, 1), kept.readsObject(5, 1), thrownBy(kept.readsObject, null, 1), kept.usesThis.call({ x: 1 }, 1), thrownBy(kept.usesThis, 1)].join(), "2,s1,NaN,TypeError,2,TypeError", "objects and this from outside");
check(Object.defineProperty({ }, "p", { get: kept.takesAnything }).p, 9, "as a getter");
check([kept.appliesCallback(x => x + "!", "a"), thrownBy(kept.appliesCallback, 1, 2), kept.countsDown(2), kept.countsDown("2"), kept.countsDown(-1)].join(), "a!,TypeError,2,2,0", "the helper and the recursive function from outside");

console.log("passed");
