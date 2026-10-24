function classify(value) {
    if (value instanceof Map) return "Map";
    else if (value instanceof Set) return "Set";
    else if (value instanceof Array) return "Array";
    else if (value instanceof Date) return "Date";
    else if (value instanceof RegExp) return "RegExp";
    else if (value instanceof Promise) return "Promise";
    else if (value instanceof Error) return "Error";
    return "none";
}

class SubMap extends Map {}
class SubSet extends Set {}
class SubArray extends Array {}
class SubDate extends Date {}
class SubRegExp extends RegExp {}
class SubPromise extends Promise {}
class SubError extends Error {}

const expected = [
    ["Map", new Map(), "Map"],
    ["Set", new Set(), "Set"],
    ["Array", [], "Array"],
    ["Date", new Date(0), "Date"],
    ["RegExp", /a/, "RegExp"],
    ["Promise", Promise.resolve(1), "Promise"],
    ["Error", new Error("e"), "Error"],
    ["TypeError", new TypeError("e"), "Error"],
    ["SubMap", new SubMap(), "Map"],
    ["SubSet", new SubSet(), "Set"],
    ["SubArray", new SubArray(), "Array"],
    ["SubDate", new SubDate(0), "Date"],
    ["SubRegExp", new SubRegExp("a"), "RegExp"],
    ["SubPromise", new SubPromise(() => {}), "Promise"],
    ["SubError", new SubError("e"), "Error"],
    ["Object.create(Map.prototype)", Object.create(Map.prototype), "Map"],
    ["Object.create(Set.prototype)", Object.create(Set.prototype), "Set"],
    ["Object.create(Date.prototype)", Object.create(Date.prototype), "Date"],
    ["array with the prototype of Map", Object.setPrototypeOf([], Map.prototype), "Map"],
    ["array with the prototype of Object", Object.setPrototypeOf([], Object.prototype), "none"],
    ["array without a prototype", Object.setPrototypeOf([], null), "none"],
    ["Map with the prototype of Set", Object.setPrototypeOf(new Map(), Set.prototype), "Set"],
    ["proxy of Map", new Proxy(new Map(), {}), "Map"],
    ["proxy that answers Date", new Proxy({}, { getPrototypeOf: () => Date.prototype }), "Date"],
    ["plain object", {}, "none"],
    ["Object.create(null)", Object.create(null), "none"],
    ["function", function () {}, "none"],
    ["number", 1, "none"],
    ["double", 1.5, "none"],
    ["string", "Map", "none"],
    ["boolean", false, "none"],
    ["symbol", Symbol("Map"), "none"],
    ["bigint", 1n, "none"],
    ["undefined", undefined, "none"],
    ["null", null, "none"],
];

for (const [label, value, answer] of expected) {
    const found = classify(value);
    console.log(label, found);
    if (found !== answer) throw new Error(`${label}: expected ${answer}, found ${found}`);
}

let matches = 0;
for (let round = 0; round < 20000; round++) {
    const [label, value, answer] = expected[round % expected.length];
    if (classify(value) !== answer) throw new Error(`round ${round}: ${label}`);
    if (answer !== "none") matches++;
}
console.log(matches);

const negatives = [{}, 1];
for (const value of negatives) {
    const isInstance = [Map, Set, Array, Date, RegExp, Promise, Error].some(builtinClass => value instanceof builtinClass);
    console.log(isInstance);
}
console.log(new SubMap() instanceof Map, new SubError("e") instanceof Error, new SubArray() instanceof Array);
