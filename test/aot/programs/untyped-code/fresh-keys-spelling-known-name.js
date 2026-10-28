const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTGetByValGeneric") + count("operationAOTGetByVal");

const anew = names => names.map(name => name.length < 2 ? name : name.slice(0, 1) + name.slice(1));
const keysAnew = () => anew(["alpha", "beta", "gamma", "missing", "inherited", "computed"]);
const read = (object, key) => object[key];
const warm = { alpha: 0, beta: 0, gamma: 0, missing: 0, inherited: 0, computed: 0, length: 0, name: 0, constructor: 0, prototype: 0, byteLength: 0 };
const spelled = keys => { for (const key of keys) read(warm, key); return keys; };
const readAll = object => keysAnew().map(key => String(read(object, key))).join(" ") + " | " + spelled(keysAnew()).map(key => String(read(object, key))).join(" ");

const grandparent = { };
const parent = Object.setPrototypeOf({ inherited: "from the parent", get computed() { return "computed for " + this.alpha; } }, grandparent);
const make = n => { const made = Object.create(parent); made.alpha = n; made.beta = n + 1; made.gamma = n + 2; return made; };

for (let i = 0; i < 40; i++) readAll(make(i));
console.log("own, inherited, computed, absent:", readAll(make(100)));

const shadowing = make(1);
shadowing.inherited = "its own";
console.log("an own value in front of the parent's:", readAll(shadowing));
console.log("another object is not touched by it:", readAll(make(2)));

parent.inherited = "changed in the parent";
console.log("the parent's value changes:", readAll(make(3)));
parent.missing = "no longer missing";
console.log("the parent gains a name:", readAll(make(4)));
delete parent.missing;
console.log("and loses it again:", readAll(make(5)));
grandparent.missing = "in the grandparent";
console.log("the grandparent gains it:", readAll(make(6)));
delete grandparent.missing;
console.log("and loses it:", readAll(make(7)));
delete parent.inherited;
console.log("the parent loses a name:", readAll(make(8)));
parent.inherited = "back";
Object.defineProperty(parent, "computed", { get() { return "another getter for " + this.beta; }, configurable: true });
console.log("another getter:", readAll(make(9)));
Object.defineProperty(parent, "computed", { value: "a value now", configurable: true, writable: true });
console.log("a value in place of the getter:", readAll(make(10)));
Object.defineProperty(parent, "computed", { get() { return "computed for " + this.alpha; }, configurable: true });

const moved = make(11);
for (let i = 0; i < 40; i++) readAll(moved);
Object.setPrototypeOf(moved, { inherited: "from a new parent" });
console.log("an object given a new parent:", readAll(moved));
Object.setPrototypeOf(moved, null);
console.log("and none:", readAll(moved));

const shrinking = make(12);
for (let i = 0; i < 40; i++) readAll(shrinking);
delete shrinking.beta;
console.log("an own name deleted:", readAll(shrinking));
shrinking.beta = "again";
console.log("and set again:", readAll(shrinking));

const accessorOfItsOwn = make(13);
Object.defineProperty(accessorOfItsOwn, "gamma", { get() { return "own getter sees " + this.alpha; }, configurable: true, enumerable: true });
for (let i = 0; i < 40; i++) readAll(accessorOfItsOwn);
console.log("an own getter:", readAll(accessorOfItsOwn));

const large = {};
for (let i = 0; i < 200; i++) large["name" + i] = i;
for (let i = 0; i < 150; i++) delete large["name" + i];
large.alpha = "in a large object";
for (let i = 0; i < 40; i++) readAll(large);
console.log("an object with many names come and gone:", readAll(large));
large.beta = "added";
delete large.alpha;
console.log("after one more of each:", readAll(large));

const otherKeys = () => anew(["length", "name", "constructor", "__proto__", "0", "12", "-1", "1.5", "prototype", "byteLength"]);
const describe = value => typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value);
const readOthers = object => spelled(otherKeys()).map(key => key + "=" + describe(read(object, key))).join(" ");
function named(a, b) { return a + b; }
class Point { constructor(x) { this.alpha = x; this.beta = -x; } get gamma() { return this.alpha * 2; } }
const bases = {
    array: () => [7, 8, 9], heir: () => new (class extends Array {})(3), function: () => named, bound: () => named.bind(null), string: () => "text", wrapper: () => new String("text"),
    typed: () => new Uint8Array(14), map: () => new Map(), arguments: () => (function () { return arguments; })(5, 6), number: () => 5, symbol: () => Symbol.iterator, instance: () => new Point(4),
    withoutParent: () => Object.create(null), frozen: () => Object.freeze({ 0: "zero", length: "frozen" }),
    proxy: () => new Proxy({}, { get(target, key, receiver) { return "trapped " + String(key); } }),
};
for (const [label, base] of Object.entries(bases)) {
    for (let i = 0; i < 12; i++) { readOthers(base()); readAll(base()); }
    console.log(label + ":", readOthers(base()), "|", readAll(base()));
}
for (const nothing of [null, undefined]) {
    for (const key of keysAnew().slice(0, 2)) {
        try { read(nothing, key); console.log("no error"); } catch (error) { console.log(error instanceof TypeError); }
    }
}

const stores = [make(1), { alpha: 1, beta: 2, gamma: 3, inherited: 4 }, new Point(2), { gamma: 1, alpha: 2 }];
let total = 0;
const round = () => {
    for (const key of keysAnew()) {
        for (const store of stores) {
            const value = read(store, key);
            if (typeof value === "number") total += value;
        }
    }
};
for (let i = 0; i < 300; i++) round();
const before = visits();
for (let i = 0; i < 1000; i++) round();
const asked = visits() - before;
console.log("the sum:", total);
console.log("the run time is asked at most 8400 times for 24000 reads under 6000 keys made anew:", typeof aotOperationCount !== "function" || asked <= 8400);
