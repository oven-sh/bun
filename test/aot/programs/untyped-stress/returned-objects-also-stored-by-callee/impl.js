function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
(function () {
    "use strict";
    function work(x) { let sum = 0; for (let i = 0; i < 3; i++) sum += x ^ i; return sum; }
    function expectedWork(x) { return (x ^ 0) + (x ^ 1) + (x ^ 2); }
    let keptInVariable = null;
    const holder = { kept: null };
    const list = [];
    let getter = null;
    const map = new Map();
    function remember(object) { keptInVariable = object; }

    function keepsInVariable(i) { const made = { a: work(i), b: i }; keptInVariable = made; return made; }
    function keepsInProperty(i) { const made = { a: work(i), b: i }; holder.kept = made; return made; }
    function keepsInArray(i) { const made = { a: work(i), b: i }; list.push(made); return made; }
    function keepsInElement(i) { const made = { a: work(i), b: i }; list[0] = made; return made; }
    function keepsInClosure(i) { const made = { a: work(i), b: i }; getter = () => made; return made; }
    function keepsInMap(i) { const made = { a: work(i), b: i }; map.set("k", made); return made; }
    function keepsInLiteral(i) { const made = { a: work(i), b: i }; holder.kept = { inner: made }; return made; }
    function keepsSometimes(i) { const made = { a: work(i), b: i }; if (i & 1) keptInVariable = made; return made; }
    function keepsThroughCall(i) { const made = { a: work(i), b: i }; remember(made); return made; }
    function keepsDirectly(i) { return keptInVariable = { a: work(i), b: i }; }
    function keepsInOneReturn(i) { if (i & 1) { const made = { a: work(i), b: i }; keptInVariable = made; return made; } return { a: work(i), b: -1 }; }

    function readsVariable(i) { const { a, b } = keepsInVariable(i); return a + b === keptInVariable.a + keptInVariable.b && a === expectedWork(i) && b === i; }
    function mutatesVariable(i) { const got = keepsInVariable(i); got.a = "changed"; got.c = 3; return got === keptInVariable && keptInVariable.a === "changed" && keptInVariable.c === 3; }
    function readsProperty(i) { const { a, b } = keepsInProperty(i); holder.kept.a = "later"; return a === expectedWork(i) && b === i && holder.kept.a === "later" && holder.kept.b === i; }
    function mutatesProperty(i) { const got = keepsInProperty(i); got.b = "changed"; return got === holder.kept && holder.kept.b === "changed"; }
    function readsArray(i) { const got = keepsInArray(i); return got.a === expectedWork(i) && got.b === i && list[list.length - 1].b === i; }
    function mutatesArray(i) { const got = keepsInArray(i); got.a = -1; return got === list[list.length - 1] && list[list.length - 1].a === -1; }
    function readsElement(i) { const { a, b } = keepsInElement(i); return a === list[0].a && b === list[0].b && b === i; }
    function mutatesElement(i) { const got = keepsInElement(i); got.a = -1; return got === list[0] && list[0].a === -1; }
    function readsClosure(i) { const got = keepsInClosure(i); return got.a === expectedWork(i) && getter() === getter() && getter().b === i; }
    function mutatesClosure(i) { const got = keepsInClosure(i); got.a = "changed"; return got === getter() && getter().a === "changed"; }
    function readsMap(i) { const { a, b } = keepsInMap(i); return a === map.get("k").a && b === i; }
    function mutatesMap(i) { const got = keepsInMap(i); got.b = "changed"; return got === map.get("k") && map.get("k").b === "changed"; }
    function readsLiteral(i) { const { a, b } = keepsInLiteral(i); return a === holder.kept.inner.a && b === i; }
    function mutatesLiteral(i) { const got = keepsInLiteral(i); got.b = "changed"; return got === holder.kept.inner && holder.kept.inner.b === "changed"; }
    function readsSometimes(i) { keptInVariable = null; const { a, b } = keepsSometimes(i); return a === expectedWork(i) && b === i && (i & 1 ? keptInVariable.b === i : keptInVariable === null); }
    function mutatesSometimes(i) { keptInVariable = null; const got = keepsSometimes(i); got.b = "changed"; return i & 1 ? got === keptInVariable && keptInVariable.b === "changed" : keptInVariable === null; }
    function readsThroughCall(i) { const { a } = keepsThroughCall(i); return a === expectedWork(i) && keptInVariable.a === a; }
    function mutatesThroughCall(i) { const got = keepsThroughCall(i); got.a = "changed"; return got === keptInVariable && keptInVariable.a === "changed"; }
    function readsDirectly(i) { const { b } = keepsDirectly(i); return b === i && keptInVariable.b === i; }
    function mutatesDirectly(i) { const got = keepsDirectly(i); got.b = "changed"; return got === keptInVariable && keptInVariable.b === "changed"; }
    function readsOneReturn(i) { keptInVariable = null; const { a, b } = keepsInOneReturn(i); return a === expectedWork(i) && (i & 1 ? b === i && keptInVariable.b === i : b === -1 && keptInVariable === null); }
    function mutatesOneReturn(i) { keptInVariable = null; const got = keepsInOneReturn(i); got.b = "changed"; return i & 1 ? got === keptInVariable && keptInVariable.b === "changed" : keptInVariable === null && got.b === "changed"; }

    const callers = {
        readsVariable, mutatesVariable, readsProperty, mutatesProperty, readsArray, mutatesArray, readsElement, mutatesElement, readsClosure, mutatesClosure, readsMap, mutatesMap,
        readsLiteral, mutatesLiteral, readsSometimes, mutatesSometimes, readsThroughCall, mutatesThroughCall, readsDirectly, mutatesDirectly, readsOneReturn, mutatesOneReturn,
    };
    for (const [name, caller] of Object.entries(callers)) {
        for (let i = 0; i < 300; i++)
            check(caller(i), true, name + " in round " + i);
    }
})();
console.log("passed");
