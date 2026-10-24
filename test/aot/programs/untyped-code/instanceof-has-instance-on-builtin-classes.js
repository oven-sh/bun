// Symbol.hasInstance cannot be defined on Map, Set or Int8Array: the constructors are locked, and a well-known symbol is a key that stays absent there. So a run of `instanceof` tests against these classes answers after the attempts as before them.
// A class of the program that extends Map takes the definition, and `instanceof` calls it.
const lines = [];
function attempt(what, change) {
    try {
        lines.push(what + ": " + String(change()));
    } catch (error) {
        lines.push(what + ": throws " + error.constructor.name);
    }
}
function kind(value) {
    if (value instanceof Map) return "Map";
    if (value instanceof Set) return "Set";
    if (value instanceof Int8Array) return "Int8Array";
    return "none";
}
function kinds() { return [{}, new Map, new Set, new Int8Array(1), 5, null].map(kind).join(); }
let calls = 0;
const withValue = { value() { calls++; return true; }, configurable: true };
const withGetter = { get() { calls++; return () => true; }, configurable: true };

lines.push("before: " + kinds());
for (const constructor of [Map, Set, Int8Array]) {
    const name = constructor.name;
    attempt("Object.defineProperty(" + name + ", Symbol.hasInstance, value)", () => Object.defineProperty(constructor, Symbol.hasInstance, withValue) === constructor);
    attempt("Object.defineProperty(" + name + ", Symbol.hasInstance, getter)", () => Object.defineProperty(constructor, Symbol.hasInstance, withGetter) === constructor);
    attempt("Reflect.defineProperty(" + name + ", Symbol.hasInstance, value)", () => Reflect.defineProperty(constructor, Symbol.hasInstance, withValue));
    attempt("Reflect.set(" + name + ", Symbol.hasInstance, function)", () => Reflect.set(constructor, Symbol.hasInstance, withValue.value));
    lines.push("Object.hasOwn(" + name + ", Symbol.hasInstance): " + Object.hasOwn(constructor, Symbol.hasInstance));
}
lines.push("after: " + kinds());
lines.push("calls: " + calls);

class OwnMap extends Map { }
attempt("Object.defineProperty(OwnMap, Symbol.hasInstance, value)", () => Object.defineProperty(OwnMap, Symbol.hasInstance, withValue) === OwnMap);
lines.push("({}) instanceof OwnMap: " + (({}) instanceof OwnMap));
lines.push("kind(new OwnMap): " + kind(new OwnMap));
lines.push("calls: " + calls);
console.log(lines.join("\n"));
