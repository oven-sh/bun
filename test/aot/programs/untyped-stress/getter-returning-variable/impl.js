function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function repeat(f) {
    for (let i = 0; i < 200; i++)
        f(i);
}
function throwsReferenceError(f, what) {
    try {
        f();
    } catch (error) {
        check(error instanceof ReferenceError, true, what);
        return;
    }
    throw new Error(what + ": did not throw");
}

let live = 1;
const fixed = "fixed";
function declared() { return "declared"; }
class Declared { }

const getLive = () => live;
const getFixed = () => fixed;
const getDeclared = () => declared;
const getClass = () => Declared;
const getLater = () => later;
const getLivePlusOne = () => live + 1;
const getConstant = () => 5;
function makeGetLocal() { let local = "local"; return { get: function getLocal() { return local; }, set(value) { local = value; } }; }
const local = makeGetLocal();

function define(target, all) {
    for (const name in all)
        Object.defineProperty(target, name, { get: all[name], enumerable: true, configurable: true });
    return target;
}

function readLive(o) { return o.live; }
function readFixed(o) { return o.fixed; }
function readDeclared(o) { return o.declared; }
function readClass(o) { return o.Declared; }
function readLater(o) { return o.later; }
function readOther(o) { return o.other; }
for (const f of [readLive, readFixed, readDeclared, readClass, readLater, readOther])
    noInline(f);

const ns = define({}, { live: getLive, fixed: getFixed, declared: getDeclared, Declared: getClass, later: getLater });

repeat(i => {
    live = i;
    check(readLive(ns), i, "a variable that changes");
});
live = "text";
check(readLive(ns), "text", "a variable of another type");
live = undefined;
check(readLive(ns), undefined, "a variable that is undefined");
live = null;
check(readLive(ns), null, "a variable that is null");
live = 0;
check(readLive(ns), 0, "a variable that is zero");
repeat(() => check(readFixed(ns), "fixed", "a constant"));
repeat(() => check(readDeclared(ns)(), "declared", "a function declaration"));
repeat(() => check(readClass(ns), Declared, "a class"));

repeat(() => throwsReferenceError(() => readLater(ns), "a variable that is not initialized"));
let later = "now";
repeat(() => check(readLater(ns), "now", "a variable that has been initialized"));

{
    const first = define({}, { other: getLive });
    const second = define({}, { other: getFixed });
    const third = define({}, { other: getLivePlusOne });
    const fourth = define({}, { other: local.get });
    live = 10;
    repeat(() => {
        check(readOther(first), 10, "the first of four objects with the same shape");
        check(readOther(second), "fixed", "the second of four objects with the same shape");
        check(readOther(third), 11, "the third of four objects with the same shape");
        check(readOther(fourth), "local", "the fourth of four objects with the same shape");
    });
    local.set("changed");
    check(readOther(fourth), "changed", "a variable of a function");
}

function readInherited(o) { return o.live; }
noInline(readInherited);
{
    const inheriting = Object.create(ns);
    repeat(i => {
        live = i;
        check(readInherited(inheriting), i, "a getter that is inherited");
    });
}

function readRedefined(o) { return o.value; }
noInline(readRedefined);
{
    const target = define({}, { value: getFixed });
    repeat(() => check(readRedefined(target), "fixed", "before the getter is replaced"));
    define(target, { value: getConstant });
    repeat(() => check(readRedefined(target), 5, "after the getter is replaced by one that returns no variable"));
    live = "live";
    define(target, { value: getLive });
    repeat(() => check(readRedefined(target), "live", "after the getter is replaced by one that returns another variable"));
    Object.defineProperty(target, "value", { value: "plain" });
    repeat(() => check(readRedefined(target), "plain", "after the getter is replaced by a value"));
}

function accessProp(key) { return this[key]; }
function readThroughBoth(o) { return o.live; }
function readLaterThroughBoth(o) { return o.evenLater; }
noInline(readThroughBoth);
noInline(readLaterThroughBoth);
{
    const inner = define({}, { live: getLive, evenLater: () => evenLater });
    const outer = {};
    for (const key of Object.getOwnPropertyNames(inner))
        Object.defineProperty(outer, key, { get: accessProp.bind(inner, key), enumerable: true });
    repeat(i => {
        live = i;
        check(readThroughBoth(outer), i, "through a bound function and a getter");
    });
    repeat(() => throwsReferenceError(() => readLaterThroughBoth(outer), "through both, not initialized"));
    define(inner, { live: getConstant });
    repeat(() => check(readThroughBoth(outer), 5, "through both, after the inner getter is replaced"));
    define(inner, { live: getFixed });
    repeat(() => check(readThroughBoth(outer), "fixed", "through both, after the inner getter is replaced again"));
    Object.defineProperty(inner, "live", { value: "plain", writable: true });
    repeat(() => check(readThroughBoth(outer), "plain", "through both, after the inner getter becomes a value"));
}
let evenLater = 1;

function readValue(o) { return o.value; }
noInline(readValue);
{
    function makeCell(initial) {
        let value = initial;
        return Object.defineProperty({ set(next) { value = next; } }, "value", { get: () => value, enumerable: true });
    }
    const cells = [];
    for (let i = 0; i < 8; i++)
        cells.push(makeCell("cell " + i));
    repeat(i => check(readValue(cells[i % 8]), "cell " + i % 8, "closures of one function, each with its own variable"));
    cells[3].set("changed");
    repeat(i => check(readValue(cells[i % 8]), i % 8 == 3 ? "changed" : "cell " + i % 8, "after one of the variables changes"));

    function makeNested(initial) {
        let value = initial;
        return (function () {
            let unrelated = "unrelated";
            return [Object.defineProperty({ }, "value", { get: () => value }), () => unrelated, next => { value = next; }];
        })();
    }
    const [nested, , setNested] = makeNested("outer variable");
    repeat(() => check(readValue(nested), "outer variable", "a variable two scopes out"));
    setNested("set");
    repeat(() => check(readValue(nested), "set", "a variable two scopes out, changed"));

    for (let round = 0; round < 5; round++) {
        (function () {
            const shortLived = makeCell("round " + round);
            repeat(() => check(readValue(shortLived), "round " + round, "a cell that is about to die"));
        })();
        fullGC();
        const fillers = [];
        for (let i = 0; i < 200; i++)
            fillers.push(makeCell("filler " + i));
        repeat(i => check(readValue(fillers[i]), "filler " + i, "cells made after a collection"));
    }
}
console.log("passed");
