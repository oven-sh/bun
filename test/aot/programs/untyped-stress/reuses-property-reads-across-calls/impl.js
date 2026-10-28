function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function repeat(f) {
    for (let i = 0; i < 100; i++)
        f(i);
}

function program() {
// Big enough not to be inlined, so that the calls stay calls.
function pad(x) { return ((((x | 0) + 1) * 3 - 2) ^ 5) + ((x | 0) >> 1) - ((x | 0) & 3) + ((x | 0) % 7) * 2 - ((x | 0) << 1) + ((x | 0) >>> 2); }
function readsOnly(o) { return pad(o.kind) + pad(o.b) + pad(o.kind + 1) + pad(o.b + 1); }
function storesB(o, v) { o.b = pad(v) - pad(v) + v; return pad(v) + pad(v + 1) + pad(v + 2); }
function storesA(o, v) { o.a = pad(v) - pad(v) + v; return pad(v) + pad(v + 1) + pad(v + 2); }
function callsStoresA(o, v) { return storesA(o, v) + pad(v) + pad(v + 3) + pad(v + 4); }
function callsReadsOnly(o) { return readsOnly(o) + pad(1) + pad(2) + pad(3); }
function recurses(o, n) { return n > 0 ? recurses(o, n - 1) + pad(o.kind) + pad(n) + pad(n + 1) : 0; }
function recursesAndStoresA(o, n) { if (n > 0) { o.a = n; return recursesAndStoresA(o, n - 1) + pad(n) + pad(n + 1) + pad(n + 2); } return 0; }
let unknown = function (o) { o.a = 50; };
function callsUnknown(o) { unknown(o); return pad(1) + pad(2) + pad(3) + pad(4); }
function storesComputed(o, key, v) { o[key] = v; return pad(v) + pad(v + 1) + pad(v + 2) + pad(v + 3); }
function deletes(o) { delete o.a; return pad(1) + pad(2) + pad(3) + pad(4); }
function constructs(o) { return new Maker(o).made + pad(1) + pad(2) + pad(3); }
function Maker(o) { this.made = 1; o.a = 60; }

function aroundReadsOnly(o) { const before = o.a; const r = readsOnly(o); return before * 1000 + o.a + r - r; }
function aroundStoresB(o, v) { const before = o.a; const r = storesB(o, v); return before * 1000 + o.a + r - r; }
function aroundStoresA(o, v) { const before = o.a; const r = storesA(o, v); return before * 1000 + o.a + r - r; }
function aroundCallsStoresA(o, v) { const before = o.a; const r = callsStoresA(o, v); return before * 1000 + o.a + r - r; }
function aroundCallsReadsOnly(o) { const before = o.a; const r = callsReadsOnly(o); return before * 1000 + o.a + r - r; }
function aroundRecurses(o) { const before = o.a; const r = recurses(o, 3); return before * 1000 + o.a + r - r; }
function aroundRecursesAndStoresA(o) { const before = o.a; const r = recursesAndStoresA(o, 3); return before * 1000 + o.a + r - r; }
function aroundCallsUnknown(o) { const before = o.a; const r = callsUnknown(o); return before * 1000 + o.a + r - r; }
function aroundStoresComputed(o, key, v) { const before = o.a; const r = storesComputed(o, key, v); return before * 1000 + o.a + r - r; }
function aroundDeletes(o) { const before = o.a; const r = deletes(o); return String(before) + String(o.a) + String(r - r); }
function aroundConstructs(o) { const before = o.a; const r = constructs(o); return before * 1000 + o.a + r - r; }
function aroundStoresBReadsB(o, v) { const before = o.b; const r = storesB(o, v); return before * 1000 + o.b + r - r; }

repeat(i => {
    check(aroundReadsOnly({ a: i, b: 1, kind: 2 }), i * 1001, "a call that only reads");
    check(aroundStoresB({ a: i, b: 1 }, 7), i * 1001, "a call that stores to another name");
    check(aroundCallsReadsOnly({ a: i, b: 1, kind: 2 }), i * 1001, "a call that calls one that only reads");
    check(aroundRecurses({ a: i, kind: 2 }), i * 1001, "a call that calls itself");
    check(aroundStoresA({ a: i }, 7), i * 1000 + 7, "a call that stores to the name");
    check(aroundCallsStoresA({ a: i }, 7), i * 1000 + 7, "a call that calls one that stores to the name");
    check(aroundRecursesAndStoresA({ a: i }), i * 1000 + 1, "a call that calls itself and stores to the name");
    check(aroundCallsUnknown({ a: i }), i * 1000 + 50, "a call that calls what is not known");
    check(aroundStoresComputed({ a: i }, "a", 7), i * 1000 + 7, "a call that stores under a computed name");
    check(aroundStoresComputed({ a: i }, "z", 7), i * 1001, "a call that stores under another computed name");
    check(aroundDeletes({ a: i }), i + "undefined0", "a call that deletes");
    check(aroundConstructs({ a: i }), i * 1000 + 60, "a call that constructs");
    check(aroundStoresBReadsB({ b: i }, 7), i * 1000 + 7, "the name that the call stores to");
});

{
    const changing = { a: 1, b: 1, get kind() { this.a = 9; return 2; } };
    repeat(() => {
        changing.a = 1;
        check(aroundReadsOnly(changing), 1009, "a getter that the callee runs changes the property");
        changing.a = 1;
        check(aroundCallsReadsOnly(changing), 1009, "a getter that a callee of the callee runs changes the property");
        changing.a = 1;
        check(aroundRecurses(changing), 1009, "a getter that a recursive callee runs changes the property");
    });
    const withSetter = { a: 1, set b(v) { this.a = v; } };
    repeat(() => {
        withSetter.a = 1;
        check(aroundStoresB(withSetter, 7), 1007, "a setter that the callee runs changes the property");
    });
    const target = { a: 1, b: 1 };
    target.kind = { valueOf() { target.a = 9; return 2; } };
    repeat(() => {
        target.a = 1;
        check(aroundReadsOnly(target), 1009, "valueOf that the callee runs changes the property");
    });
    const proxied = new Proxy({ a: 1, b: 1, kind: 2 }, {});
    repeat(() => check(aroundReadsOnly(proxied), 1001, "a proxy"));
}

unknown = function (o) { o.a = 51; };
check(aroundCallsUnknown({ a: 1 }), 1051, "what is not known is replaced");

const table = new Map([["k", 1]]);
const members = new Set(["k"]);
function aroundMapGet(o, map, key) { const before = o.a; const r = map.get(key); return before * 1000 + o.a + (r === undefined ? 0 : 0); }
function aroundMapHas(o, map, key) { const before = o.a; const r = map.has(key); return before * 1000 + o.a + (r ? 0 : 0); }
function aroundMapSet(o, map, key) { const before = o.a; map.set(key, 1); return before * 1000 + o.a; }
function aroundSetAdd(o, set, key) { const before = o.a; set.add(key); return before * 1000 + o.a; }
function aroundCharCodeAt(o, text) { const before = o.a; const r = text.charCodeAt(0); return before * 1000 + o.a + r - r; }
function aroundPush(o, array) { const before = o.a; array.push(1); return before * 1000 + o.a; }
function aroundOtherMethod(o, map, key) { const before = o.a; const r = map.lookUp(key); return before * 1000 + o.a + r - r; }
for (const f of [aroundMapGet, aroundMapHas, aroundMapSet, aroundSetAdd, aroundCharCodeAt, aroundPush, aroundOtherMethod])
    noInline(f);

repeat(i => {
    check(aroundMapGet({ a: i }, table, "k"), i * 1001, "Map.prototype.get");
    check(aroundMapGet({ a: i }, table, "a key that is " + i), i * 1001, "Map.prototype.get of a rope");
    check(aroundMapHas({ a: i }, table, "k"), i * 1001, "Map.prototype.has");
    check(aroundMapHas({ a: i }, members, "k"), i * 1001, "Set.prototype.has");
    check(aroundMapSet({ a: i }, table, "k" + (i & 3)), i * 1001, "Map.prototype.set");
    check(aroundSetAdd({ a: i }, members, "k" + (i & 3)), i * 1001, "Set.prototype.add");
    check(aroundCharCodeAt({ a: i }, "text"), i * 1001, "String.prototype.charCodeAt");
    check(aroundPush({ a: i }, []), i * 1001, "Array.prototype.push");
});

{
    const o = { a: 1 };
    const lookalike = {
        get(key) { o.a = 2; return key; },
        has(key) { o.a = 3; return true; },
        set(key, value) { o.a = 4; },
        add(key) { o.a = 5; },
        charCodeAt(index) { o.a = 6; return 0; },
        push(value) { o.a = 7; },
        lookUp(key) { o.a = 8; return 0; },
    };
    class Overriding extends Map {
        get(key) { o.a = 12; return super.get(key); }
    }
    const overriding = new Overriding;
    const patched = new Map;
    patched.get = function () { o.a = 13; };
    repeat(() => {
        o.a = 1; check(aroundMapGet(o, lookalike, "k"), 1002, "get of an object that is no map");
        o.a = 1; check(aroundMapHas(o, lookalike, "k"), 1003, "has of an object that is no map");
        o.a = 1; check(aroundMapSet(o, lookalike, "k"), 1004, "set of an object that is no map");
        o.a = 1; check(aroundSetAdd(o, lookalike, "k"), 1005, "add of an object that is no set");
        o.a = 1; check(aroundCharCodeAt(o, lookalike), 1006, "charCodeAt of an object that is no string");
        o.a = 1; check(aroundPush(o, lookalike), 1007, "push of an object that is no array");
        o.a = 1; check(aroundOtherMethod(o, lookalike, "k"), 1008, "another method");
        o.a = 1; check(aroundMapGet(o, overriding, "k"), 1012, "get of a map of a class that overrides it");
        o.a = 1; check(aroundMapGet(o, patched, "k"), 1013, "get of a map that has its own");
        o.a = 1; check(aroundMapGet(o, table, "k"), 1001, "get of a map, afterwards");
    });
}

function storesOnOnePath(o, c) { const before = o.a; if (c) o.a = 5; return before * 1000 + o.a; }
function storesOnBothPaths(o, c) { if (c) o.a = 5; else o.a = 6; return o.a; }
function readsOnOnePathOnly(o, c) { let x = 0; if (c) x = o.a; return x * 1000 + o.a; }
function callsOnOnePath(o, c) { const before = o.a; if (c) unknown(o); return before * 1000 + o.a; }
for (const f of [storesOnOnePath, storesOnBothPaths, readsOnOnePathOnly, callsOnOnePath])
    noInline(f);
repeat(i => {
    check(storesOnOnePath({ a: i }, true), i * 1000 + 5, "a store on the path that is taken");
    check(storesOnOnePath({ a: i }, false), i * 1001, "a store on the path that is not taken");
    check(storesOnBothPaths({ a: i }, true), 5, "a store on both paths, the first");
    check(storesOnBothPaths({ a: i }, false), 6, "a store on both paths, the second");
    check(readsOnOnePathOnly({ a: i }, true), i * 1001, "a read on one path, taken");
    check(readsOnOnePathOnly({ a: i }, false), i, "a read on one path, not taken");
    check(callsOnOnePath({ a: i }, true), i * 1000 + 51, "a call on the path that is taken");
    check(callsOnOnePath({ a: i }, false), i * 1001, "a call on the path that is not taken");
});
{
    const withSetter = { set a(v) { }, get a() { return 3; } };
    repeat(() => {
        check(storesOnOnePath(withSetter, true), 3003, "a setter on one path");
        check(storesOnBothPaths(withSetter, true), 3, "a setter on both paths");
    });
}

function readsInLoop(o, n) { let sum = o.a; for (let i = 0; i < n; i++) sum += o.a + i; return sum; }
function readsInLoopThatStoresAnother(o, n) { let sum = o.a; for (let i = 0; i < n; i++) { o.b = i; sum += o.a; } return sum; }
function readsInLoopThatCallsHarmless(o, n) { let sum = o.a; for (let i = 0; i < n; i++) sum += o.a + readsOnly(o) * 0; return sum; }
function readsInLoopThatStores(o, n) { let sum = o.a; for (let i = 0; i < n; i++) { sum += o.a; o.a = i; } return sum; }
function readsInLoopThatStoresThroughAnother(o, p, n) { let sum = o.a; for (let i = 0; i < n; i++) { sum += o.a; p.a = i; } return sum; }
function readsInLoopThatCallsUnknown(o, n) { let sum = o.a; for (let i = 0; i < n; i++) { sum += o.a; unknown(o); } return sum; }
function readsInLoopThatCallsStoresA(o, n) { let sum = o.a; for (let i = 0; i < n; i++) { sum += o.a; storesA(o, i); } return sum; }
function readsInNestedLoops(o, n) { let sum = o.a; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) sum += o.a; } return sum; }
function readsInNestedLoopsInnerStores(o, n) { let sum = o.a; for (let i = 0; i < n; i++) { sum += o.a; for (let j = 0; j < n; j++) o.a = j + 1; } return sum; }
const loops = [readsInLoop, readsInLoopThatStoresAnother, readsInLoopThatCallsHarmless, readsInLoopThatStores, readsInLoopThatStoresThroughAnother, readsInLoopThatCallsUnknown, readsInLoopThatCallsStoresA, readsInNestedLoops, readsInNestedLoopsInnerStores];
for (const f of loops)
    noInline(f);

repeat(i => {
    check(readsInLoop({ a: i }, 4), 5 * i + 6, "a loop that only reads");
    check(readsInLoop({ a: i }, 0), i, "a loop that does not run");
    check(readsInLoopThatStoresAnother({ a: i, b: 0 }, 4), 5 * i, "a loop that stores to another name");
    check(readsInLoopThatCallsHarmless({ a: i, b: 1, kind: 2 }, 4), 5 * i, "a loop that calls what only reads");
    check(readsInLoopThatStores({ a: i }, 4), 2 * i + 0 + 1 + 2, "a loop that stores to the name");
    const same = { a: i };
    check(readsInLoopThatStoresThroughAnother(same, same, 4), 2 * i + 0 + 1 + 2, "a loop that stores through another name for the object");
    check(readsInLoopThatStoresThroughAnother({ a: i }, { a: 0 }, 4), 5 * i, "a loop that stores to another object");
    check(readsInLoopThatCallsUnknown({ a: i }, 4), 2 * i + 3 * 51, "a loop that calls what is not known");
    check(readsInLoopThatCallsStoresA({ a: i }, 4), 2 * i + 0 + 1 + 2, "a loop that calls what stores to the name");
    check(readsInNestedLoops({ a: i }, 3), 10 * i, "nested loops that only read");
    check(readsInNestedLoopsInnerStores({ a: i }, 3), 2 * i + 3 + 3, "nested loops, the inner of which stores");
});
{
    let calls = 0;
    const counting = { get a() { return ++calls; } };
    check(readsInLoop(counting, 4), 1 + 2 + 3 + 4 + 5 + 6, "a getter in a loop");
    check(calls, 5, "calls of the getter in a loop");
    const changing = { a: 1, set b(v) { this.a = v + 10; } };
    check(readsInLoopThatStoresAnother(changing, 3), 1 + 10 + 11 + 12, "a setter in a loop changes the property");
    const viaGetter = { a: 1, b: 1, get kind() { this.a++; return 2; } };
    check(readsInLoopThatCallsHarmless(viaGetter, 3), 1 + 1 + 3 + 5, "a getter that a callee runs in a loop changes the property");
}
}
program();
console.log("passed");
