// @bun
// f.call(...) is compiled to a call of f. These are the ways to reach Function.prototype.call itself.
function shouldBe(actual, expected, what)
{
    actual = JSON.stringify(actual);
    expected = JSON.stringify(expected);
    if (actual !== expected)
        throw new Error(what + ": expected " + expected + " but got " + actual);
}

function shouldThrow(func, errorType, what)
{
    let error;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof errorType))
        throw new Error(what + ": expected a " + errorType.name + " but got " + error);
}

const call = Function.prototype.call;
shouldBe([call.length, call.name], [1, "call"], "length and name");

function strict() { "use strict"; return [this === undefined ? "undefined" : this, arguments.length, ...arguments]; }
const sloppy = new Function(`return [this === globalThis ? "global" : typeof this, arguments.length, ...arguments];`);
function target() { return new.target === undefined; }
function thrower(value) { throw new RangeError(value); }
class Base { constructor() { } }

const uncurried = call.bind(strict);
const uncurriedSloppy = call.bind(sloppy);
const callCall = call.bind(call);
const withThis = call.bind(strict, "bound this");
const withArguments = call.bind(strict, "bound this", 1, 2);
const hasOwn = call.bind(Object.prototype.hasOwnProperty);
const slice = call.bind(Array.prototype.slice);
const includes = call.bind(String.prototype.includes);
const push = call.bind(Array.prototype.push);
const max = call.bind(Math.max);
const symbol = Symbol();
const objects = [{ a: 1, [symbol]: 1 }, { b: 1 }, Object.create({ [symbol]: 1 }), [1], function () { }];

function test()
{
    shouldBe(uncurried(), ["undefined", 0], "no arguments");
    for (let count = 0; count <= 8; ++count) {
        const rest = Array.from({ length: count }, (_, i) => i + 1);
        shouldBe(uncurried("t", ...rest), ["t", count, ...rest], "spread, " + count);
        shouldBe(Reflect.apply(call, strict, ["t", ...rest]), ["t", count, ...rest], "Reflect.apply, " + count);
        shouldBe(callCall(strict, "t", ...rest), ["t", count, ...rest], "call.bind(call), " + count);
        shouldBe(call.call(strict, "t", ...rest), ["t", count, ...rest], "call.call, " + count);
        shouldBe(call.apply(strict, ["t", ...rest]), ["t", count, ...rest], "call.apply, " + count);
        shouldBe(withThis(...rest), ["bound this", count, ...rest], "bound this, " + count);
        shouldBe(withArguments(...rest), ["bound this", count + 2, 1, 2, ...rest], "bound arguments, " + count);
    }
    shouldBe(uncurried("t"), ["t", 0], "1");
    shouldBe(uncurried("t", 1), ["t", 1, 1], "2");
    shouldBe(uncurried("t", 1, 2), ["t", 2, 1, 2], "3");
    shouldBe(uncurried("t", 1, 2, 3), ["t", 3, 1, 2, 3], "4");
    shouldBe(uncurried("t", 1, 2, 3, 4), ["t", 4, 1, 2, 3, 4], "5");
    shouldBe(uncurried("t", undefined), ["t", 1, null], "an undefined argument counts");
    shouldBe(uncurried(undefined, undefined, undefined), ["undefined", 2, null, null], "undefined arguments count");
    shouldBe(uncurried(null), [null, 0], "null this, strict");
    shouldBe(uncurriedSloppy(), ["global", 0], "no this, sloppy");
    shouldBe(uncurriedSloppy(null, 1), ["global", 1, 1], "null this, sloppy");
    shouldBe(uncurriedSloppy(1, 1), ["object", 1, 1], "primitive this, sloppy");
    shouldBe(call.bind(target)(), true, "new.target");
    shouldBe(callCall(callCall, callCall, strict, "t", 1), ["t", 1, 1], "nested");

    shouldBe(objects.map(object => hasOwn(object, symbol)), [true, false, false, false, false], "hasOwnProperty, symbol");
    shouldBe(objects.map(object => hasOwn(object, "a")), [true, false, false, false, false], "hasOwnProperty, string");
    shouldBe(objects.map(object => hasOwn(object, 0)), [false, false, false, true, false], "hasOwnProperty, index");
    shouldBe(objects.map(object => hasOwn(object)), [false, false, false, false, false], "hasOwnProperty, nothing");
    shouldBe([slice([1, 2, 3]), slice([1, 2, 3], 1), slice([1, 2, 3], 1, 2), slice("abc", 1)], [[1, 2, 3], [2, 3], [2], ["b", "c"]], "slice");
    shouldBe([includes("abc", "b"), includes("abc", "b", 2), includes("abc")], [true, false, false], "includes");
    const array = [];
    shouldBe([push(array), push(array, 1), push(array, 2, 3), push(array, 4, 5, 6), push(array, 7, 8, 9, 10, 11), array], [0, 1, 3, 6, 11, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], "push");
    shouldBe([max(null, 1, 3, 2), max(null, 1, 3, 2, 5, 4), max()], [3, 5, null], "Math.max");

    shouldThrow(() => hasOwn(undefined, "a"), TypeError, "hasOwnProperty of undefined");
    shouldThrow(() => hasOwn(null, "a"), TypeError, "hasOwnProperty of null");
    shouldThrow(() => call.bind(thrower)(null, "x"), RangeError, "the callee throws");
    shouldThrow(() => call.bind(Base)(), TypeError, "a class constructor");
    for (const notCallable of [undefined, null, 1, "s", symbol, {}, []]) {
        for (let count = 0; count <= 6; ++count)
            shouldThrow(() => Reflect.apply(call, notCallable, Array(count).fill(1)), TypeError, "not callable, " + count);
        shouldThrow(() => callCall(notCallable, 1, 2), TypeError, "not callable, call.bind(call)");
    }
    shouldThrow(() => new call(), TypeError, "new");
}
noInline(test);

for (let i = 0; i < testLoopCount / 200; ++i)
    test();

// Hot enough for the DFG and the FTL to inline the bound function, Function.prototype.call and the callee.
function hot(object, i)
{
    return [hasOwn(object, symbol), hasOwn(object, "a"), uncurried(object, i)[2], callCall(strict, object, i, 1)[1], includes("abc", "b"), max(null, i, 1, 2, 3, 4)];
}
noInline(hot);
for (let i = 5; i < testLoopCount; ++i)
    shouldBe(hot(objects[i % 2], i), [!(i % 2), !(i % 2), i, 2, true, i], "hot");

// A callee that changes, and an argument count that changes, at one call site.
function callIt(f, ...rest) { return callCall(f, ...rest); }
noInline(callIt);
for (let i = 0; i < testLoopCount / 2; ++i) {
    shouldBe(callIt(strict, "t", i), ["t", 1, i], "same callee");
    if (!(i % 100)) {
        shouldBe(callIt(sloppy, 1, i, 2, 3, 4, 5), ["object", 5, i, 2, 3, 4, 5], "another callee");
        shouldBe(callIt(Math.max, null, i, -1), i, "a native callee");
    }
}

// Many arguments.
shouldBe(uncurried("t", ...Array(10000).fill(0))[1], 10000, "10000 arguments");
shouldThrow(() => uncurried("t", ...Array(0x100001).fill(0)), RangeError, "too many arguments");

// The arguments are read when the call is made.
function reassigns(a, b) { "use strict"; a = 10; b = 20; return [arguments[0], arguments[1], a, b]; }
shouldBe(call.bind(reassigns)(null, 1, 2), [1, 2, 10, 20], "the callee's parameters");
