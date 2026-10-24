// object[key] where the object's own property under the key is an accessor: what bundlers make of `export * from` and `export { a } from`: a getter a name, read through a function that
// holds the name in a variable. Getters in the object and out of line, under strings and symbols, without a getter, throwing, replaced by a value and back, deleted, inherited, on many shapes.
const lines = [];
function read(object, key) { return object[key]; }
function reexport(target, source) {
    for (const key of Object.keys(source)) {
        if (key === "default" || key in target) continue;
        Object.defineProperty(target, key, { enumerable: true, get: function () { return source[key]; } });
    }
    return target;
}
let counter = 0;
const inner = {};
for (const name of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"])
    Object.defineProperty(inner, name, { enumerable: true, get() { counter++; return name.toUpperCase() + (this === inner ? "" : "?"); } });
const middle = reexport({}, inner);
const outer = reexport({ own: "plain" }, middle);
const names = Object.keys(outer);
for (let round = 0; round < 4; round++) {
    const row = names.map(name => read(outer, name)).join();
    if (round === 3) lines.push(row + " " + counter);
}
const sym = Symbol("s");
const mixed = { a: 1, get b() { return this.a + 1; }, set c(v) { this.a = v; }, get [sym]() { return "by symbol " + this.a; }, get thrower() { throw new RangeError("from a getter"); } };
function look(tag, object) {
    let row = tag;
    for (let round = 0; round < 3; round++) {
        for (const key of ["a", "b", "c", sym, "missing"])
            row += " " + String(read(object, key));
        try { row += " " + read(object, "thrower"); } catch (error) { row += " " + error.constructor.name; }
    }
    lines.push(row);
}
look("mixed", mixed);
mixed.c = 10;
look("stored through the setter", mixed);
Object.defineProperty(mixed, "b", { value: "a value now", writable: true, configurable: true, enumerable: true });
look("a value", mixed);
Object.defineProperty(mixed, "b", { get() { return "a getter again"; }, configurable: true });
look("a getter again", mixed);
delete mixed.b;
look("deleted", mixed);
const heir = Object.create(mixed);
heir.a = 100;
look("inherited", heir);
Object.defineProperty(heir, sym, { get() { return "own now " + this.a; }, configurable: true });
look("own now", heir);
const frozen = Object.freeze({ get f() { return "frozen"; }, thrower: 0 });
lines.push([read(frozen, "f"), read(frozen, "f"), read(frozen, "f")].join());
const shapes = [];
for (let i = 0; i < 40; i++) {
    const object = {};
    for (let j = 0; j <= i % 9; j++) object["filler" + j] = j;
    Object.defineProperty(object, "wanted", { get() { return i * 2 + Object.keys(this).length; }, enumerable: false });
    shapes.push(object);
}
let sum = 0;
for (let round = 0; round < 5; round++)
    for (const object of shapes) sum += read(object, "wanted");
lines.push("shapes " + sum);
function changing() {
    const object = { get g() { Object.defineProperty(object, "g", { value: "replaced itself", configurable: true }); return "first"; } };
    return [read(object, "g"), read(object, "g"), read(object, "g")].join();
}
lines.push(changing(), changing());
class WithAccessors { get p() { return "of the class"; } static get s() { return "static"; } }
const instance = new WithAccessors;
lines.push([read(instance, "p"), read(instance, "p"), read(WithAccessors, "s"), read(WithAccessors, "s"), read(WithAccessors.prototype, "p"), read(WithAccessors.prototype, "p")].join());
console.log(lines.join("\n"));
