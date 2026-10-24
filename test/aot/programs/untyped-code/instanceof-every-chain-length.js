// `value instanceof constructor` in code without types, for values whose prototype chains have none, one, two and more links, end at Object.prototype or do not, pass through a proxy,
// are changed under way, or belong to constructors made anew at each call; and for right-hand sides whose `prototype` is replaced, is no object, or that answer for themselves.
const lines = [];
function is(value, constructor) { return value instanceof constructor; }
function row(value, constructors) { return constructors.map(constructor => is(value, constructor) ? 1 : 0).join(""); }
class Animal { constructor() { this.legs = 4; } }
class Dog extends Animal { }
class Puppy extends Dog { }
class Runt extends Puppy { }
function Plain() { this.a = 1; }
function Other() { }
const constructors = [Object, Function, Array, Map, Set, Error, TypeError, Promise, Date, RegExp, ArrayBuffer, Uint8Array, Int32Array, DataView, WeakMap, Animal, Dog, Puppy, Runt, Plain, Other];
const bare = Object.create(null);
const belowBare = Object.create(bare);
const likeMap = Object.create(Map.prototype);
const belowLikeMap = Object.create(likeMap);
const values = [
    undefined, null, true, 0, 1.5, "text", 10n, Symbol.iterator,
    {}, { a: 1 }, [], [1, 2], () => 0, function () { }, class { },
    new Map, new Set, new Error("e"), new TypeError("t"), Promise.resolve(1), new Date(0), /x/, new ArrayBuffer(8), new Uint8Array(2), new Int32Array(2), new DataView(new ArrayBuffer(8)), new WeakMap,
    new Animal, new Dog, new Puppy, new Runt, new Plain, new Other,
    bare, belowBare, likeMap, belowLikeMap, Object.prototype, Array.prototype, Function.prototype, Map.prototype, Animal.prototype, Dog.prototype,
];
for (let round = 0; round < 3; round++) {
    const rows = values.map(value => row(value, constructors));
    if (round === 2)
        lines.push(...rows);
}

const moved = new Dog;
lines.push("moved " + row(moved, [Animal, Dog, Plain, Object]));
Object.setPrototypeOf(moved, Plain.prototype);
lines.push("moved " + row(moved, [Animal, Dog, Plain, Object]));
Object.setPrototypeOf(moved, null);
lines.push("moved " + row(moved, [Animal, Dog, Plain, Object]));

const middle = { middle: true };
const leaf = Object.create(middle);
lines.push("middle " + row(leaf, [Plain, Other, Object]));
Object.setPrototypeOf(middle, Plain.prototype);
lines.push("middle " + row(leaf, [Plain, Other, Object]));
Object.setPrototypeOf(middle, Other.prototype);
lines.push("middle " + row(leaf, [Plain, Other, Object]));

const early = new Plain;
const firstPrototype = Plain.prototype;
Plain.prototype = { replaced: true };
const late = new Plain;
lines.push("replaced " + is(early, Plain) + " " + is(late, Plain) + " " + firstPrototype.isPrototypeOf(early));
for (const wrong of [undefined, null, 5, "p", Symbol.iterator]) {
    Plain.prototype = wrong;
    try { lines.push("wrong " + is(late, Plain)); } catch (error) { lines.push("wrong " + error.constructor.name); }
    try { lines.push("wrong " + is(5, Plain)); } catch (error) { lines.push("wrong " + error.constructor.name); }
}
Plain.prototype = firstPrototype;
lines.push("back " + is(early, Plain) + " " + is(late, Plain));

let asked = 0;
const watched = new Proxy({}, { getPrototypeOf() { asked++; return Dog.prototype; } });
const belowWatched = Object.create(watched);
lines.push("proxy " + row(watched, [Animal, Dog, Puppy, Object]) + " " + row(belowWatched, [Animal, Dog, Puppy, Object]) + " " + asked);
const throwing = new Proxy({}, { getPrototypeOf() { throw new RangeError("no"); } });
try { is(throwing, Dog); } catch (error) { lines.push("proxy " + error.constructor.name); }
try { is(Object.create(throwing), Dog); } catch (error) { lines.push("proxy " + error.constructor.name); }

const bound = Dog.bind(null);
lines.push("bound " + is(new Dog, bound) + " " + is(new Animal, bound) + " " + is({}, bound));
const even = { [Symbol.hasInstance](value) { return value % 2 === 0; } };
lines.push("own answer " + is(2, even) + " " + is(3, even));
class Odd { static [Symbol.hasInstance](value) { return value % 2 === 1; } }
lines.push("own answer " + is(2, Odd) + " " + is(3, Odd) + " " + is(new Odd, Odd));
for (const wrong of [undefined, null, 5, "c", {}, [], Symbol.iterator]) {
    try { lines.push("right side " + is({}, wrong)); } catch (error) { lines.push("right side " + error.constructor.name); }
}
lines.push("arrow " + (() => { try { return is({}, () => 0); } catch (error) { return error.constructor.name; } })());

function makeClass() { return class Made { constructor() { this.made = 1; } }; }
function makeFunction() { return function Made() { this.made = 1; }; }
let before = null;
let tally = 0;
for (let i = 0; i < 200; i++) {
    const Made = i % 2 ? makeClass() : makeFunction();
    const made = new Made;
    if (is(made, Made)) tally += 1;
    if (before && is(made, before)) tally += 1000;
    if (is(made, Object)) tally += 1;
    if (is(made, Map)) tally += 1000;
    before = Made;
}
lines.push("made anew " + tally);

function kind(value) {
    if (value instanceof Map) return "Map";
    if (value instanceof Set) return "Set";
    if (value instanceof Error) return "Error";
    if (value instanceof ArrayBuffer) return "ArrayBuffer";
    if (value instanceof Int8Array) return "Int8Array";
    if (value instanceof Uint8Array) return "Uint8Array";
    if (value instanceof Float64Array) return "Float64Array";
    if (value instanceof DataView) return "DataView";
    if (value instanceof Date) return "Date";
    if (value instanceof Promise) return "Promise";
    if (value instanceof Array) return "Array";
    if (value instanceof Function) return "Function";
    if (value instanceof Object) return "Object";
    return typeof value;
}
lines.push(values.map(kind).join(" "));
console.log(lines.join("\n"));
