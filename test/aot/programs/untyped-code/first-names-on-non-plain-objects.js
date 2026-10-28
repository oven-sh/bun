const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
class Later extends Promise { }
class Table extends Map { }
class WithFields extends Promise { status = "field"; value = 1; reason = 2; extra = 3; fifth = 5; sixth = 6; }
class TableWithFields extends Map { first = 1; second = 2; third = 3; fourth = 4; fifth = 5; }
function* generate() { yield 1; yield 2; }
async function* generateLater() { yield 1; }
const kinds = {
    "a promise": [() => new Promise(resolve => resolve(7)), o => o instanceof Promise],
    "a resolved promise": [() => Promise.resolve(1), o => typeof o.then === "function"],
    "an heir of Promise": [() => new Later(() => { }), o => o instanceof Later],
    "a map": [() => new Map([[1, 2]]), o => o.get(1) === 2 && o.size === 1],
    "an heir of Map": [() => new Table([[1, 2]]), o => o.get(1) === 2 && o instanceof Table],
    "a set": [() => new Set([1]), o => o.has(1)],
    "a weak map": [() => new WeakMap(), o => !o.has({})],
    "a weak set": [() => new WeakSet(), o => !o.has({})],
    "a date": [() => new Date(5), o => o.getTime() === 5],
    "a generator": [() => generate(), o => o.next().value === 1],
    "an async generator": [() => generateLater(), o => typeof o.next === "function"],
    "a buffer": [() => new ArrayBuffer(3), o => o.byteLength === 3],
    "a number object": [() => new Number(4), o => o + 1 === 5],
    "a boolean object": [() => new Boolean(true), o => o.valueOf()],
    "a symbol object": [() => Object(Symbol.iterator), o => o.valueOf() === Symbol.iterator],
    "a weak reference": [() => new WeakRef(kinds), o => o.deref() === kinds],
    "a string object": [() => new String("ab"), o => o.length === 2 && o[1] === "b"],
    "a pattern": [() => /a/g, o => o.test("a") && o.lastIndex === 1],
    "an error": [() => new Error("m"), o => o.message === "m" && typeof o.stack === "string"],
    "a function": [() => function named() { return 1; }, o => o() === 1 && o.name === "named"],
    "an arrow": [() => () => 1, o => o() === 1],
    "a bound function": [() => (function () { return this; }).bind(5), o => o() == 5],
    "an array": [() => [1, 2], o => o.length === 2 && o[1] === 2],
    "a typed array": [() => new Uint8Array([1, 2]), o => o[1] === 2 && o.buffer.byteLength === 2],
    "a view": [() => new DataView(new ArrayBuffer(2)), o => o.byteLength === 2],
    "arguments": [() => (function () { return arguments; })(1, 2), o => o.length === 2 && o[0] === 1],
    "a plain object": [() => ({}), o => true],
    "an object without a parent": [() => Object.create(null), o => true],
    "a proxy": [() => new Proxy({}, {}), o => true],
};
const give = (o, n) => { o.status = "pending"; o.value = n; o.reason = [n]; o.extra = { n }; o.fifth = n + 0.5; o.sixth = "six"; o.seventh = null; o.eighth = undefined; o.ninth = n; return o; };
const show = o => Reflect.ownKeys(o).filter(key => typeof key === "string" && !/^\d+$/.test(key) && !["length", "name", "prototype", "lastIndex", "message", "stack", "line", "column", "sourceURL", "callee", "originalLine", "originalColumn"].includes(key)).map(key => key + "=" + JSON.stringify(o[key])).join(" ");
for (const [label, [make, holds]] of Object.entries(kinds)) {
    for (let i = 0; i < 30; i++) give(make(), i);
    const made = give(make(), 42);
    collect();
    console.log(label + ":", holds(made), show(made));
}

for (let i = 0; i < 30; i++) { new WithFields(() => { }); new TableWithFields(); }
console.log("fields of an heir of Promise:", show(new WithFields(() => { })), "| and names behind them:", show(give(new WithFields(() => { }), 1)));
console.log("fields of an heir of Map:", show(new TableWithFields()), new TableWithFields([[1, 2]]).get(1));

const seen = [];
class Watched extends Promise { }
const giveOne = (o, v) => { o.status = v; return o; };
for (let i = 0; i < 40; i++) giveOne(new Watched(() => { }), i);
console.log("before a setter:", show(giveOne(new Watched(() => { }), "own")));
Object.defineProperty(Watched.prototype, "status", { set(v) { seen.push(v); }, get() { return "from the getter"; }, configurable: true });
const behind = giveOne(new Watched(() => { }), "to the setter");
console.log("a setter has come to the class:", show(behind), seen.join(), behind.status);
delete Watched.prototype.status;
console.log("and gone:", show(giveOne(new Watched(() => { }), "own again")));
Object.defineProperty(Watched.prototype, "status", { value: "fixed", writable: false, configurable: true });
try { giveOne(new Watched(() => { }), "refused"); console.log("no error"); } catch (error) { console.log("a value that may not be written in the class:", error instanceof TypeError); }
delete Watched.prototype.status;
try { giveOne(Object.preventExtensions(new Watched(() => { })), "refused"); console.log("no error"); } catch (error) { console.log("a promise that takes no more:", error instanceof TypeError); }
try { giveOne(Object.freeze(new Map()), "refused"); console.log("no error"); } catch (error) { console.log("a frozen map:", error instanceof TypeError); }
const between = Object.create(Promise.prototype, { status: { set(v) { seen.push("between " + v); }, configurable: true } });
const moved = new Watched(() => { });
Object.setPrototypeOf(moved, between);
console.log("a promise given another parent:", show(giveOne(moved, "x")), seen.at(-1));
console.log("the next one is as ever:", show(giveOne(new Watched(() => { }), "y")));

const kept = [];
for (let i = 0; i < 400; i++) { kept.push(give(new Promise(() => { }), i), give(new Map(), i), give(new Date(i), i)); if (i % 50 === 0) collect(); }
collect();
console.log("kept across collections:", kept.every((o, i) => o.value === Math.floor(i / 3) && o.reason[0] === o.value && o.extra.n === o.value && o.ninth === o.value));

const counted = ["a promise", "a resolved promise", "an heir of Promise", "a map", "an heir of Map", "a set", "a weak map", "a date", "a generator", "an async generator", "a buffer", "a number object"].map(label => kinds[label][0]);
const round = n => { for (const make of counted) give(make(), n); };
for (let i = 0; i < 200; i++) round(i);
const before = count("operationAOTPutByIdAndCache");
for (let i = 0; i < 500; i++) round(i);
const visited = count("operationAOTPutByIdAndCache") - before;
console.log("the run time is asked at most 300 times for 54000 names given to 6000 objects:", typeof aotOperationCount !== "function" || visited <= 300);
