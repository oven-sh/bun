// x instanceof C where C has a Symbol.hasInstance of the program's own (as node:stream's Writable has): an own one, an inherited one, a static method of a class, one that answers with what is
// no boolean, that throws, that is replaced, deleted, no function; `this` and the argument it is given; and what is no object on the left of a class whose prototype nothing has asked for yet.
const lines = [];
function test(x, C) { return x instanceof C; }
function attempt(x, C) { try { return String(test(x, C)); } catch (error) { return error.constructor.name + (error.message === "mine" ? ":mine" : ""); } }
const values = [{}, [], function () {}, { marked: true }, Object.create(null), 1, "text", null, undefined, true, Symbol.iterator, 10n];
function row(name, C) {
    const cells = [name];
    for (let round = 0; round < 3; round++) cells.push(values.map(x => attempt(x, C)).join(""));
    lines.push(cells.join(" ").replaceAll("true", "T").replaceAll("false", "f"));
}
const defaultHasInstance = Function.prototype[Symbol.hasInstance];
function Writable() {}
Object.defineProperty(Writable, Symbol.hasInstance, { __proto__: null, value: function (object) {
    if (defaultHasInstance.call(this, object)) return true;
    if (this !== Writable) return false;
    return object && object.marked;
} });
function Heir() {}
Object.setPrototypeOf(Heir, Writable);
Heir.prototype = Object.create(Writable.prototype);
values.push(new Writable, new Heir);
row("own", Writable);
row("inherited", Heir);
class WithStatic { static [Symbol.hasInstance](x) { return typeof x === "number"; } }
class HeirOfStatic extends WithStatic {}
row("static", WithStatic);
row("heir of static", HeirOfStatic);
const seen = [];
const Recorder = { [Symbol.hasInstance](x) { seen.push(this === Recorder, arguments.length, typeof x); return 0; } };
row("an object", Recorder);
lines.push(seen.slice(0, 9).join() + " " + seen.length);
for (const [name, answer] of [["zero", 0], ["one", 1], ["empty", ""], ["text", "x"], ["NaN", NaN], ["object", {}], ["null", null], ["undefined", undefined], ["bigint", 0n], ["symbol", Symbol.iterator]])
    row("answers " + name, { [Symbol.hasInstance]() { return answer; } });
row("throws", { [Symbol.hasInstance]() { throw new RangeError("mine"); } });
row("no function", { [Symbol.hasInstance]: 5 });
row("null", Object.assign(function () {}, {}));
function Changing() {}
Object.defineProperty(Changing, Symbol.hasInstance, { value() { return true; }, configurable: true, writable: true });
row("changing: first", Changing);
Object.defineProperty(Changing, Symbol.hasInstance, { value() { return false; }, configurable: true, writable: true });
row("changing: another function", Changing);
Object.defineProperty(Changing, Symbol.hasInstance, { value: undefined, configurable: true, writable: true });
row("changing: undefined", Changing);
Object.defineProperty(Changing, Symbol.hasInstance, { get() { return () => "got"; }, configurable: true });
row("changing: a getter", Changing);
delete Changing[Symbol.hasInstance];
row("changing: deleted", Changing);
function Base() {}
function Derived() {}
Object.setPrototypeOf(Derived, Base);
row("before the base has one", Derived);
Object.defineProperty(Base, Symbol.hasInstance, { value(x) { return x === 1; }, configurable: true });
row("the base has one now", Derived);
Object.defineProperty(Derived, Symbol.hasInstance, { value(x) { return x === "text"; }, configurable: true });
row("its own in front", Derived);
delete Derived[Symbol.hasInstance];
row("the base's again", Derived);
function NeverAsked() {}
class NeverAskedClass {}
const arrow = () => {};
const primitives = [1, "text", null, undefined, true, 10n, Symbol.iterator];
for (const [name, C] of [["a function", NeverAsked], ["a class", NeverAskedClass], ["an arrow", arrow], ["bound", NeverAsked.bind(null)]]) {
    const cells = [name];
    for (let round = 0; round < 3; round++) cells.push(primitives.map(x => attempt(x, C)).join(""));
    cells.push(attempt({}, C), attempt(typeof C.prototype === "object" ? Object.create(C.prototype) : {}, C), primitives.map(x => attempt(x, C)).join(""));
    lines.push(cells.join(" ").replaceAll("true", "T").replaceAll("false", "f"));
}
let count = 0;
const stream = { marked: true }, plain = {};
for (let i = 0; i < 20000; i++) count += (test(stream, Writable) ? 1 : 0) + (test(plain, Writable) ? 2 : 0) + (test(i, NeverAsked) ? 4 : 0);
lines.push(String(count));
console.log(lines.join("\n"));
