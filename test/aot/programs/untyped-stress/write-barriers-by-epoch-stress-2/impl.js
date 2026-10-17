function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let litter = [];
function fillsFreedCells(n) {
    litter = [];
    for (let i = 0; i < 2000; i++)
        litter.push({ n: -1 - n }, [-1 - n], { n: -1 - n, m: -2 - n }, "litter " + i);
}
function overwritesStack(depth) { return depth ? overwritesStack(depth - 1) + 1 : 0; }
function collectsAndFills(n) {
    overwritesStack(100);
    edenGC();
    fillsFreedCells(n);
}
function readsProperty(o) { return o.n; }
check(readsProperty({ n: 1 }), 1, "a property");

function capturesParameters(first, second) {
    return {
        gets() { return [first, second]; },
        sets(a, b) { first = a; second = b; },
    };
}
function capturesVariable(n) {
    var held = n;
    return {
        gets() { return held; },
        sets(v) { held = v; },
    };
}
for (let i = 0; i < 300; i++) {
    let pair = capturesParameters({ n: i }, [i]);
    let single = capturesVariable({ n: i, m: i + 1 });
    if (i % 3 === 0)
        collectsAndFills(i);
    check(pair.gets()[0].n, i, "an object in a new environment");
    check(pair.gets()[1][0], i, "an array in a new environment");
    check(single.gets().m, i + 1, "an object in a variable of a new environment");
    if (i % 7 === 0)
        fullGC();
    pair.sets({ n: i + 1 }, "text " + i);
    single.sets([i]);
    collectsAndFills(i);
    check(pair.gets()[0].n, i + 1, "an object in an environment that has aged");
    check(pair.gets()[1], "text " + i, "a string in an environment that has aged");
    check(single.gets()[0], i, "an array in an environment that has aged");
}

function collectsBeforeStoring(n) {
    var held = (edenGC(), { n });
    return {
        gets() { return held; },
        sets(v) { held = v; },
    };
}
function allocatesBeforeStoring(n) {
    var held = { n, m: [n] };
    return {
        gets() { return held; },
        sets(v) { held = v; },
    };
}
function storesString() {
    var held = "a string constant that is long enough not to be shared with anything else";
    return {
        gets() { return held; },
        sets(v) { held = v; },
    };
}
for (let i = 0; i < 200; i++) {
    let collected = collectsBeforeStoring(i);
    let allocated = allocatesBeforeStoring(i);
    let string = storesString();
    collectsAndFills(i);
    check(collected.gets().n, i, "an object made after the environment survived a collection");
    check(allocated.gets().m[0], i, "an object allocated after the environment");
    check(string.gets().length, 73, "a string constant");
}

function storesTwoObjects(n) {
    var first = null, second = null;
    let access = {
        gets() { return [first, second]; },
        sets(a, b) { first = a; second = b; },
    };
    fullGC();
    let a = { n }, b = [n];
    first = a;
    second = b;
    a = b = null;
    collectsAndFills(n);
    return access;
}
function storesAnythingThenObject(n, anything) {
    var first = null, second = null;
    let access = {
        gets() { return [first, second]; },
        sets(a, b) { first = a; second = b; },
    };
    fullGC();
    let b = [n];
    first = anything;
    second = b;
    b = anything = null;
    collectsAndFills(n);
    return access;
}
function storesObjectThenAnything(n, anything) {
    var first = null, second = null;
    let access = {
        gets() { return [first, second]; },
        sets(a, b) { first = a; second = b; },
    };
    fullGC();
    let a = { n };
    first = a;
    second = anything;
    a = anything = null;
    collectsAndFills(n);
    return access;
}
function storesObjectThenNumber(n) {
    var first = null, second = null;
    let access = {
        gets() { return [first, second]; },
        sets(a, b) { first = a; second = b; },
    };
    fullGC();
    let a = { n };
    first = a;
    second = n | 0;
    a = null;
    collectsAndFills(n);
    return access;
}
function callsBetweenStores(n) {
    var first = null, second = null;
    let access = {
        gets() { return [first, second]; },
        sets(a, b) { first = a; second = b; },
    };
    fullGC();
    let a = { n }, b = [n];
    first = a;
    a = null;
    collectsAndFills(n);
    second = b;
    b = null;
    collectsAndFills(n);
    return access;
}
function storesInTwoEnvironments(n) {
    var first = null;
    let access = {
        gets() { return [first, inner.gets()]; },
        sets(a) { first = a; },
    };
    let inner = capturesVariable(null);
    fullGC();
    let a = { n }, b = [n];
    first = a;
    inner.sets(b);
    a = b = null;
    collectsAndFills(n);
    return access;
}
for (let i = 0; i < 40; i++) {
    let values = storesTwoObjects(i).gets();
    check(values[0].n, i, "the first of two objects stored in an old environment");
    check(values[1][0], i, "the second of two objects stored in an old environment");
    values = storesAnythingThenObject(i, { n: i, m: i }).gets();
    check(values[0].m, i, "an object of unknown type stored before an object");
    check(values[1][0], i, "the object stored after it");
    values = storesAnythingThenObject(i, i + 0.5).gets();
    check(values[0], i + 0.5, "a number of unknown type stored before an object");
    check(values[1][0], i, "the object stored after it");
    values = storesObjectThenAnything(i, "text " + i).gets();
    check(values[0].n, i, "an object stored before a string of unknown type");
    check(values[1], "text " + i, "the string stored after it");
    values = storesObjectThenAnything(i, i).gets();
    check(values[0].n, i, "an object stored before a number of unknown type");
    check(values[1], i, "the number stored after it");
    values = storesObjectThenNumber(i).gets();
    check(values[0].n, i, "an object stored before a number");
    check(values[1], i, "the number stored after it");
    values = callsBetweenStores(i).gets();
    check(values[0].n, i, "an object stored before a collection");
    check(values[1][0], i, "an object stored after it");
    values = storesInTwoEnvironments(i).gets();
    check(values[0].n, i, "an object in one old environment");
    check(values[1][0], i, "an object in another");
}

let settled = [];
async function keepsAcrossAwait(n) {
    let a = { n }, b = [n], c = "text " + n;
    await undefined;
    collectsAndFills(n);
    let d = { n: a.n + b[0] }, e = [c];
    await undefined;
    fullGC();
    fillsFreedCells(n);
    settled.push(a.n + b[0] + d.n + e[0] + c);
}
for (let i = 0; i < 20; i++) {
    keepsAcrossAwait(i);
    drainMicrotasks();
    check(settled.pop(), i * 4 + "text " + i + "text " + i, "values that live across an await");
}

console.log("passed");
