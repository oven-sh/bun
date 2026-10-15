function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f) {
    try {
        f();
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
function calls(f, ...args) { return f(...args); }
function callsWithOne(f, a) { return f(a); }
function callsWithNone(f) { return f(); }
function constructs(C, ...args) { return new C(...args); }
function constructsWithOne(C, a) { return new C(a); }
function constructsWithNone(C) { return new C(); }
for (let f of [calls, callsWithOne, callsWithNone, constructs, constructsWithOne, constructsWithNone])
    noInline(f);

for (let round = 0; round < 3; ++round) {
    check(constructsWithNone(Map).size, 0, "new Map()");
    check(constructsWithOne(Map, [[1, 2]]).get(1), 2, "new Map(entries)");
    check(constructsWithOne(Set, [1, 1, 2]).size, 2, "new Set(values)");
    check(constructsWithNone(WeakMap) instanceof WeakMap, true, "new WeakMap()");
    check(constructsWithOne(Array, 3).length, 3, "new Array(3)");
    check(callsWithOne(Array, 3).length, 3, "Array(3)");
    check(constructs(Array, 1, 2, 3).join(), "1,2,3", "new Array(1, 2, 3)");
    check(constructsWithOne(Error, "text").message, "text", "new Error(text)");
    check(callsWithOne(Error, "text").message, "text", "Error(text)");
    check(callsWithOne(TypeError, "text") instanceof TypeError, true, "TypeError(text)");
    check(constructsWithOne(Date, 5).getTime(), 5, "new Date(5)");
    check(typeof callsWithNone(Date), "string", "Date()");
    check(constructsWithOne(RegExp, "a+").test("caat"), true, "new RegExp(source)");
    check(callsWithOne(RegExp, "a+").source, "a+", "RegExp(source)");
    check(callsWithOne(String, 5), "5", "String(5)");
    check(typeof constructsWithOne(String, 5), "object", "new String(5)");
    check(callsWithOne(Number, "7"), 7, "Number(text)");
    check(callsWithOne(Boolean, 0), false, "Boolean(0)");
    check(callsWithOne(BigInt, 7), 7n, "BigInt(7)");
    check(typeof callsWithOne(Symbol, "name"), "symbol", "Symbol(name)");
    check(typeof callsWithOne(Object, 1), "object", "Object(1)");
    check(constructsWithOne(Uint8Array, 4).length, 4, "new Uint8Array(4)");
    check(constructsWithOne(ArrayBuffer, 8).byteLength, 8, "new ArrayBuffer(8)");
    check(constructsWithOne(Promise, resolve => resolve(1)) instanceof Promise, true, "new Promise(executor)");
    check(constructs(Function, "a", "return a + 1")(1), 2, "new Function(a, body)");
    check(constructs(Proxy, {}, {}) instanceof Object, true, "new Proxy(target, handler)");

    check(thrownBy(() => callsWithNone(Map)), "TypeError", "Map()");
    check(thrownBy(() => callsWithNone(Set)), "TypeError", "Set()");
    check(thrownBy(() => callsWithOne(Promise, () => { })), "TypeError", "Promise(executor)");
    check(thrownBy(() => callsWithOne(Uint8Array, 4)), "TypeError", "Uint8Array(4)");
    check(thrownBy(() => constructsWithNone(Symbol)), "TypeError", "new Symbol()");
    check(thrownBy(() => constructsWithOne(BigInt, 1)), "TypeError", "new BigInt(1)");
    check(thrownBy(() => constructsWithNone(Math.max)), "TypeError", "new Math.max()");
    check(thrownBy(() => constructsWithOne(Array, -1)), "RangeError", "new Array(-1)");
    for (let notCallable of [undefined, null, 1, "text", {}, [], Symbol(), 1n, Math]) {
        check(thrownBy(() => callsWithNone(notCallable)), "TypeError", "calling " + typeof notCallable);
        check(thrownBy(() => constructsWithNone(notCallable)), "TypeError", "constructing " + typeof notCallable);
    }

    class Table extends Map { constructor(entries) { super(entries); this.made = new.target.name; } }
    class Failure extends Error { }
    check(constructsWithOne(Table, [[1, 2]]).get(1), 2, "a subclass of Map");
    check(constructsWithNone(Table).made, "Table", "new.target in a subclass of Map");
    check(constructsWithNone(Table) instanceof Map, true, "a subclass of Map");
    check(constructsWithOne(Failure, "text") instanceof Failure, true, "a subclass of Error");
    check(Reflect.construct(Map, [], Table) instanceof Table, true, "Reflect.construct with another new.target");
    check(constructsWithNone(Map.bind(null)).size, 0, "a bound Map");
    check(thrownBy(() => callsWithNone(Map.bind(null))), "TypeError", "calling a bound Map");
    check(constructsWithNone(new Proxy(Map, {})).size, 0, "a proxy of Map");
    check(callsWithOne(new Proxy(String, {}), 5), "5", "a proxy of String");
    check(constructsWithNone(createGlobalObject().Map) instanceof Map, false, "Map of another realm");
    check(constructsWithNone(createGlobalObject().Map).size, 0, "Map of another realm");
    check(callsWithOne(createGlobalObject().Error, "text") instanceof Error, false, "Error of another realm");
    check(callsWithNone(makeMasquerader()), undefined === undefined ? callsWithNone(makeMasquerader()) : 0, "a function that masquerades as undefined");
}
console.log("passed");
