function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function accessProp(key) { return this[key]; }
function accessPropStrict(key) { "use strict"; return this[key]; }
function accessPropPlusOne(key) { return this[key] + 1; }

function wrapWith(accessor, mod, keys = Object.getOwnPropertyNames(mod)) {
    const to = {};
    for (const key of keys)
        Object.defineProperty(to, key, { get: accessor.bind(mod, key), enumerable: true });
    return to;
}
function wrap(mod, keys) { return wrapWith(accessProp, mod, keys); }
function repeat(f) {
    for (let i = 0; i < 200; i++)
        f(i);
}

function readLive(o) { return o.c; }
noInline(readLive);
{
    const mod = { a: 1, b: 2, c: 3 };
    const wrapper = wrap(mod);
    repeat(i => {
        mod.c = i;
        check(readLive(wrapper), i, "a value that changes");
    });
    mod.c = "text";
    check(readLive(wrapper), "text", "a value of another type");
    mod.c = undefined;
    check(readLive(wrapper), undefined, "undefined");
}

function readShared(o) { return o.c; }
noInline(readShared);
{
    const first = wrap({ a: 1, b: 2, c: "first" });
    const second = wrap({ a: 1, b: 2, c: "second" });
    const third = wrap({ c: "third", a: 1, b: 2 }, ["a", "b", "c"]);
    repeat(() => {
        check(readShared(first), "first", "the first of three wrappers with the same keys");
        check(readShared(second), "second", "the second of three wrappers with the same keys");
        check(readShared(third), "third", "the third, of an object with another layout");
    });
}

function readReshaped(o) { return o.c; }
noInline(readReshaped);
{
    const mod = { a: 1, b: 2, c: 3 };
    const wrapper = wrap(mod);
    repeat(() => check(readReshaped(wrapper), 3, "before anything is added"));
    mod.d = 4;
    repeat(() => check(readReshaped(wrapper), 3, "after a property is added"));
    delete mod.a;
    repeat(() => check(readReshaped(wrapper), 3, "after another property is deleted"));
    delete mod.c;
    repeat(() => check(readReshaped(wrapper), undefined, "after the property is deleted"));
    mod.c = 5;
    repeat(() => check(readReshaped(wrapper), 5, "after the property is added again"));
    let calls = 0;
    Object.defineProperty(mod, "c", { get() { return ++calls; }, configurable: true });
    repeat(i => check(readReshaped(wrapper), i + 1, "after the property becomes an accessor"));
    Object.defineProperty(mod, "c", { value: 6, writable: true, configurable: true });
    repeat(() => check(readReshaped(wrapper), 6, "after the property becomes a value again"));
}

function readOutOfLine(o) { return o.p40; }
noInline(readOutOfLine);
{
    const mod = {};
    for (let i = 0; i < 50; i++)
        mod["p" + i] = i;
    const wrapper = wrap(mod);
    repeat(() => check(readOutOfLine(wrapper), 40, "a property outside the object"));
    mod.p40 = 41;
    check(readOutOfLine(wrapper), 41, "a property outside the object, changed");
}

function readDictionary(o) { return o.p150; }
noInline(readDictionary);
{
    const mod = {};
    for (let i = 0; i < 300; i++)
        mod["p" + i] = i;
    for (let i = 0; i < 100; i++)
        delete mod["p" + i];
    const wrapper = wrap(mod);
    repeat(() => check(readDictionary(wrapper), 150, "a dictionary"));
    delete mod.p150;
    repeat(() => check(readDictionary(wrapper), undefined, "a dictionary that lost the property"));
    mod.p150 = 7;
    repeat(() => check(readDictionary(wrapper), 7, "a dictionary that has the property again"));
}

function readWithMoreArguments(o) { return o.c; }
noInline(readWithMoreArguments);
{
    const mod = { a: 1, b: 2, c: 3 };
    const wrapper = {};
    Object.defineProperty(wrapper, "c", { get: accessProp.bind(mod, "c", mod, 2) });
    repeat(() => check(readWithMoreArguments(wrapper), 3, "three bound arguments"));
    const other = {};
    Object.defineProperty(other, "c", { get: accessProp.bind(mod, "c", { c: 9 }) });
    repeat(() => check(readWithMoreArguments(other), 3, "two bound arguments"));
    const none = {};
    Object.defineProperty(none, "c", { get: accessProp.bind({ undefined: "u" }) });
    repeat(() => check(readWithMoreArguments(none), "u", "no bound argument"));
}

function readLength(o) { return o.length; }
noInline(readLength);
{
    const ofString = {};
    Object.defineProperty(ofString, "length", { get: accessPropStrict.bind("four", "length") });
    repeat(() => check(readLength(ofString), 4, "bound to a string"));
    const ofArray = {};
    const array = [1, 2, 3];
    Object.defineProperty(ofArray, "length", { get: accessProp.bind(array, "length") });
    repeat(() => check(readLength(ofArray), 3, "bound to an array"));
    array.push(4);
    check(readLength(ofArray), 4, "bound to an array that grew");
}

function readProxied(o) { return o.c; }
noInline(readProxied);
{
    let traps = 0;
    const wrapper = wrap(new Proxy({ c: 3 }, { get(target, key) { traps++; return target[key]; } }), ["c"]);
    repeat(() => check(readProxied(wrapper), 3, "bound to a proxy"));
    check(traps, 200, "calls of the proxy's trap");
}

function readIndex(o) { return o.one; }
noInline(readIndex);
{
    const array = [10, 11, 12];
    const wrapper = {};
    Object.defineProperty(wrapper, "one", { get: accessProp.bind(array, "1") });
    repeat(() => check(readIndex(wrapper), 11, "a name that is an index"));
    array[1] = 21;
    check(readIndex(wrapper), 21, "a name that is an index, changed");
}

function readInherited(o) { return o.c; }
noInline(readInherited);
{
    const prototype = { c: 3 };
    const mod = Object.create(prototype);
    const wrapper = wrap(mod, ["c"]);
    repeat(() => check(readInherited(wrapper), 3, "an inherited property"));
    prototype.c = 4;
    repeat(() => check(readInherited(wrapper), 4, "an inherited property, changed"));
    mod.c = 5;
    repeat(() => check(readInherited(wrapper), 5, "an inherited property, shadowed"));
    delete mod.c;
    repeat(() => check(readInherited(wrapper), 4, "an inherited property, no longer shadowed"));
}

function readOfFunction(o) { return o.helper; }
function readNameOfFunction(o) { return o.name; }
noInline(readOfFunction);
noInline(readNameOfFunction);
{
    function mod() { }
    mod.helper = 3;
    const wrapper = wrap(mod, ["helper", "name"]);
    repeat(() => check(readOfFunction(wrapper), 3, "bound to a function"));
    repeat(() => check(readNameOfFunction(wrapper), "mod", "the name of a function"));
    mod.helper = 4;
    check(readOfFunction(wrapper), 4, "bound to a function, changed");
}

function readSymbol(o) { return o.c; }
noInline(readSymbol);
{
    const symbol = Symbol("c");
    const wrapper = {};
    Object.defineProperty(wrapper, "c", { get: accessProp.bind({ [symbol]: 3 }, symbol) });
    repeat(() => check(readSymbol(wrapper), 3, "a symbol"));
}

function readPlusOne(o) { return o.c; }
noInline(readPlusOne);
{
    const wrapper = wrapWith(accessPropPlusOne, { c: 3 });
    repeat(() => check(readPlusOne(wrapper), 4, "a function that does something else"));
}

function readFromPrototype(o) { return o.c; }
noInline(readFromPrototype);
{
    const mod = { a: 1, b: 2, c: 3 };
    const inheriting = Object.create(wrap(mod));
    repeat(i => {
        mod.c = i;
        check(readFromPrototype(inheriting), i, "a getter that is inherited");
    });
}

function readRedefined(o) { return o.c; }
noInline(readRedefined);
{
    const wrapper = {};
    Object.defineProperty(wrapper, "c", { get: accessProp.bind({ c: "old" }, "c"), configurable: true });
    repeat(() => check(readRedefined(wrapper), "old", "before the getter is replaced"));
    Object.defineProperty(wrapper, "c", { get: accessProp.bind({ c: "new" }, "c"), configurable: true });
    repeat(() => check(readRedefined(wrapper), "new", "after the getter is replaced"));
}

function readAfterCollection(o) { return o.c; }
noInline(readAfterCollection);
{
    const mod = { a: 1, b: 2, c: 3 };
    const wrapper = wrap(mod);
    repeat(() => check(readAfterCollection(wrapper), 3, "before collections"));
    for (let round = 0; round < 5; round++) {
        mod["extra" + round] = round;
        fullGC();
        for (let i = 0; i < 50; i++)
            ({ ["unrelated" + round + "_" + i]: i, c: "wrong" });
        repeat(() => check(readAfterCollection(wrapper), 3, "after collection " + round));
    }
}
console.log("passed");
