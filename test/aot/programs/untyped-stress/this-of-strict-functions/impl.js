function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    function returnsThis() { return this; }
    function kindOfThis() { return typeof this; }
    function readsFromThis() { return this.value; }
    const escaped = [returnsThis, kindOfThis, readsFromThis];
    globalThis.escapedFunctions = escaped;

    function returnsThisOfKnownCallers() { return this; }
    function callsWithObject(o) { return returnsThisOfKnownCallers.call(o); }

    const symbol = Symbol("s");
    const large = 1n << 80n;
    const object = { value: 1 };
    const array = [1];
    const values = [
        [undefined, "undefined"], [null, "object"], [1, "number"], [1.5, "number"], [true, "boolean"],
        ["text", "string"], ["te" + String(array.length) + "xt", "string"], [symbol, "symbol"], [large, "bigint"], [1n, "bigint"],
        [object, "object"], [array, "object"], [returnsThis, "function"], [new Map, "object"], [/x/, "object"], [new Proxy({ }, { }), "object"],
        [globalThis, "object"],
    ];
    for (let round = 0; round < 50; ++round) {
        for (const [value, kind] of values) {
            const [first, second] = globalThis.escapedFunctions;
            check(first.call(value), value, "this of a strict function called with " + kind);
            check(second.call(value), kind, "typeof this of a strict function");
        }
        check(globalThis.escapedFunctions[2].call(object), 1, "a property of this");
        check(globalThis.escapedFunctions[2].call("text"), undefined, "a property of a string that is this");
        check(callsWithObject(object), object, "this of a function whose callers are known");
    }
    let message = "none";
    try { globalThis.escapedFunctions[2].call(undefined); } catch (error) { message = error.constructor.name; }
    check(message, "TypeError", "a property of undefined that is this");
})();
console.log("passed");
